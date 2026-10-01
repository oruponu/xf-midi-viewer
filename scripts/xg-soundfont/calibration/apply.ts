import { GeneratorTypes, Modulator, ModulatorControllerSources } from 'spessasynth_core';
import type {
  BasicInstrumentZone,
  BasicPreset,
  BasicPresetZone,
  BasicSoundBank,
  BasicZone,
} from 'spessasynth_core';
import type { CalibrationUnits, Corrections, DrumKey, Voice } from './corrections.ts';
import { CALIBRATION_VOICES, DRUM_KEYS, XG_DRUM_KITS } from './testMidi.ts';
import type { VoiceId } from './testMidi.ts';

export const MAX_ATTENUATION = 1440;
const ATTENUATION = GeneratorTypes.initialAttenuation;

interface KeyZone {
  readonly zone: BasicInstrumentZone;
  readonly global: BasicZone;
  readonly presetZone: BasicPresetZone;
  readonly preset: BasicPreset;
}

function velocityModulator(bank: BasicSoundBank): Modulator {
  const modulator = bank.defaultModulators.find(
    (m) =>
      !m.primarySource.isCC &&
      m.primarySource.index === ModulatorControllerSources.noteOnVelocity &&
      m.destination === ATTENUATION,
  );
  if (!modulator) throw new Error('No default velocity-to-attenuation modulator');
  return modulator;
}

function attenuationOf(zone: BasicZone, global: BasicZone): number {
  return zone.getGenerator(ATTENUATION, global.getGenerator(ATTENUATION, 0));
}

function xgKitPreset(bank: BasicSoundBank, kit: number): BasicPreset {
  const preset = bank.presets.find(
    (p) => p.bankMSB === 127 && p.bankLSB === 0 && p.program === kit && p.name.startsWith('XG '),
  );
  if (!preset) throw new Error(`XG drum kit ${kit} not found`);
  return preset;
}

function voicePreset(bank: BasicSoundBank, id: VoiceId): BasicPreset {
  const preset = bank.presets.find(
    (p) => !p.isGMGSDrum && p.bankMSB === id.bankMSB && p.bankLSB === 0 && p.program === id.program,
  );
  if (!preset) throw new Error(`Voice MSB ${id.bankMSB} / PC ${id.program} not found`);
  return preset;
}

function keyZones(preset: BasicPreset, key: number): KeyZone[] {
  return preset.zones.flatMap((pz) =>
    pz.instrument.zones
      .filter((z) => z.keyRange.min <= key && key <= z.keyRange.max)
      .map((zone) => {
        if (zone.keyRange.min !== zone.keyRange.max) {
          throw new Error(
            `${preset.name} note ${key}: cannot correct a zone that covers several keys (${zone.sample.name})`,
          );
        }
        return { zone, global: pz.instrument.globalZone, presetZone: pz, preset };
      }),
  );
}

// A layer sounds only where the preset-level and instrument-level ranges overlap.
function velocityRange({ zone, global, presetZone, preset }: KeyZone): readonly [number, number] {
  const outer = presetZone.hasVelRange ? presetZone.velRange : preset.globalZone.velRange;
  const inner = zone.hasVelRange ? zone.velRange : global.velRange;
  return [Math.max(0, outer.min, inner.min), Math.min(outer.max, inner.max)];
}

function presetLevelVelocityAmount(bank: BasicSoundBank, { presetZone, preset }: KeyZone): number {
  const reference = velocityModulator(bank);
  const own =
    presetZone.modulators.find((m) => Modulator.isIdentical(m, reference)) ??
    preset.globalZone.modulators.find((m) => Modulator.isIdentical(m, reference));
  return own?.transformAmount ?? 0;
}

function velocityAmountOf(bank: BasicSoundBank, kz: KeyZone): number {
  const reference = velocityModulator(bank);
  const { zone, global } = kz;
  const instrumentLevel = (
    zone.modulators.find((m) => Modulator.isIdentical(m, reference)) ??
    global.modulators.find((m) => Modulator.isIdentical(m, reference)) ??
    reference
  ).transformAmount;
  return instrumentLevel + presetLevelVelocityAmount(bank, kz);
}

function setVelocityAmount(bank: BasicSoundBank, kz: KeyZone, amount: number): void {
  const { zone, global } = kz;
  const reference = velocityModulator(bank);
  const own = zone.modulators.find((m) => Modulator.isIdentical(m, reference));
  const base =
    own ?? global.modulators.find((m) => Modulator.isIdentical(m, reference)) ?? reference;
  const replacement = Modulator.copyFrom(base);
  replacement.transformAmount = amount - presetLevelVelocityAmount(bank, kz);
  zone.modulators = [...zone.modulators.filter((m) => m !== own), replacement];
}

export function listUnits(bank: BasicSoundBank): CalibrationUnits {
  const drums: DrumKey[] = XG_DRUM_KITS.flatMap((kit) => {
    const preset = xgKitPreset(bank, kit);
    return DRUM_KEYS.map((key) => ({
      kit,
      key,
      layers: keyZones(preset, key).map((kz) => ({
        velocity: velocityRange(kz),
        sample: kz.zone.sample.name,
        attenuation: attenuationOf(kz.zone, kz.global),
        velocityAmount: velocityAmountOf(bank, kz),
      })),
    })).filter((d) => d.layers.length > 0);
  });
  const voices: Voice[] = CALIBRATION_VOICES.map((id) => {
    const preset = voicePreset(bank, id);
    return {
      bankMSB: id.bankMSB,
      program: id.program,
      zones: preset.zones.map((pz) => ({
        instrument: pz.instrument.name,
        attenuation: attenuationOf(pz, preset.globalZone),
        velocityAmountDelta: 0,
      })),
    };
  }).filter((v) => v.zones.length > 0);
  return { drums, voices };
}

function applyDrum(bank: BasicSoundBank, drum: DrumKey, touched: Set<BasicInstrumentZone>): void {
  const zones = keyZones(xgKitPreset(bank, drum.kit), drum.key);
  const where = `XG drum kit ${drum.kit} note ${drum.key}`;
  if (zones.length !== drum.layers.length) {
    throw new Error(
      `${where}: ${drum.layers.length} layers in the corrections but ${zones.length} in the sound bank`,
    );
  }
  zones.forEach((kz, i) => {
    const layer = drum.layers[i];
    const { zone } = kz;
    const [min, max] = velocityRange(kz);
    if (
      min !== layer.velocity[0] ||
      max !== layer.velocity[1] ||
      zone.sample.name !== layer.sample
    ) {
      throw new Error(
        `${where}: layer ${layer.sample} (${layer.velocity[0]}-${layer.velocity[1]}) in the corrections does not match ${zone.sample.name} (${min}-${max}) in the sound bank`,
      );
    }
    zone.setGenerator(ATTENUATION, layer.attenuation, false);
    setVelocityAmount(bank, kz, layer.velocityAmount);
    touched.add(zone);
  });
}

function applyVoice(bank: BasicSoundBank, voice: Voice): BasicPreset {
  const preset = voicePreset(bank, voice);
  const where = `Voice MSB ${voice.bankMSB} / PC ${voice.program}`;
  if (preset.zones.length !== voice.zones.length) {
    throw new Error(
      `${where}: ${voice.zones.length} zones in the corrections but ${preset.zones.length} in the sound bank`,
    );
  }
  const reference = velocityModulator(bank);
  preset.zones.forEach((pz, i) => {
    const correction = voice.zones[i];
    if (pz.instrument.name !== correction.instrument) {
      throw new Error(
        `${where}: instrument ${correction.instrument} in the corrections does not match ${pz.instrument.name} in the sound bank`,
      );
    }
    pz.setGenerator(ATTENUATION, correction.attenuation, false);
    if (correction.velocityAmountDelta === 0) return;
    const own = pz.modulators.find((m) => Modulator.isIdentical(m, reference));
    const base =
      own ?? preset.globalZone.modulators.find((m) => Modulator.isIdentical(m, reference));
    const replacement = Modulator.copyFrom(base ?? reference);
    replacement.transformAmount = (base?.transformAmount ?? 0) + correction.velocityAmountDelta;
    pz.modulators = [...pz.modulators.filter((m) => m !== own), replacement];
  });
  return preset;
}

function checkAttenuationRange(bank: BasicSoundBank): void {
  for (const preset of bank.presets) {
    for (const pz of preset.zones) {
      const presetValue = attenuationOf(pz, preset.globalZone);
      for (const zone of pz.instrument.zones) {
        const total = presetValue + attenuationOf(zone, pz.instrument.globalZone);
        if (total > MAX_ATTENUATION) {
          throw new Error(
            `${preset.name} / ${zone.sample.name}: total attenuation ${total} exceeds ${MAX_ATTENUATION}`,
          );
        }
      }
    }
  }
}

export function applyCorrections(bank: BasicSoundBank, corrections: Corrections): void {
  const common = corrections.commonAttenuation;
  const touchedZones = new Set<BasicInstrumentZone>();
  for (const drum of corrections.drums) applyDrum(bank, drum, touchedZones);

  const xgKits = new Set(XG_DRUM_KITS.map((kit) => xgKitPreset(bank, kit)));
  if (common !== 0) {
    for (const preset of xgKits) {
      for (const pz of preset.zones) {
        for (const zone of pz.instrument.zones) {
          if (touchedZones.has(zone)) continue;
          zone.setGenerator(
            ATTENUATION,
            attenuationOf(zone, pz.instrument.globalZone) + common,
            false,
          );
        }
      }
    }
  }

  const touchedPresets = new Set(corrections.voices.map((voice) => applyVoice(bank, voice)));
  if (common !== 0) {
    for (const preset of bank.presets) {
      if (xgKits.has(preset) || touchedPresets.has(preset)) continue;
      for (const pz of preset.zones) {
        pz.setGenerator(ATTENUATION, attenuationOf(pz, preset.globalZone) + common, false);
      }
    }
  }
  checkAttenuationRange(bank);
}
