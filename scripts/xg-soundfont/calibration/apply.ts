import {
  BasicInstrument,
  GeneratorTypes,
  Modulator,
  ModulatorControllerSources,
} from 'spessasynth_core';
import type {
  BasicInstrumentZone,
  BasicPreset,
  BasicPresetZone,
  BasicSoundBank,
  BasicZone,
} from 'spessasynth_core';
import type {
  CalibrationUnits,
  Corrections,
  DrumKey,
  RangeCorrection,
  VariationCorrection,
  Voice,
} from './corrections.ts';
import { rangeBands, rangeOffsets } from './ranges.ts';
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

function addVelocityAmount(
  bank: BasicSoundBank,
  preset: BasicPreset,
  pz: BasicPresetZone,
  delta: number,
): void {
  const reference = velocityModulator(bank);
  const own = pz.modulators.find((m) => Modulator.isIdentical(m, reference));
  const base = own ?? preset.globalZone.modulators.find((m) => Modulator.isIdentical(m, reference));
  const replacement = Modulator.copyFrom(base ?? reference);
  replacement.transformAmount = (base?.transformAmount ?? 0) + delta;
  pz.modulators = [...pz.modulators.filter((m) => m !== own), replacement];
}

function applyVoice(bank: BasicSoundBank, voice: Voice): BasicPreset {
  const preset = voicePreset(bank, voice);
  const where = `Voice MSB ${voice.bankMSB} / PC ${voice.program}`;
  if (preset.zones.length !== voice.zones.length) {
    throw new Error(
      `${where}: ${voice.zones.length} zones in the corrections but ${preset.zones.length} in the sound bank`,
    );
  }
  preset.zones.forEach((pz, i) => {
    const correction = voice.zones[i];
    if (pz.instrument.name !== correction.instrument) {
      throw new Error(
        `${where}: instrument ${correction.instrument} in the corrections does not match ${pz.instrument.name} in the sound bank`,
      );
    }
    pz.setGenerator(ATTENUATION, correction.attenuation, false);
    if (correction.velocityAmountDelta !== 0) {
      addVelocityAmount(bank, preset, pz, correction.velocityAmountDelta);
    }
  });
  return preset;
}

// Only the presets in nonNegative are held to 0 and above: the source sound bank itself goes
// below 0 (a GS ride cymbal), which the synth clamps only after adding the velocity and volume
// attenuation. The synth does not clamp the sum to the maximum either, so the presets in aboveMax
// may exceed it; messages for those zones are returned instead of thrown.
function checkAttenuationRange(
  bank: BasicSoundBank,
  nonNegative: ReadonlySet<BasicPreset> = new Set(),
  aboveMax: ReadonlySet<BasicPreset> = new Set(),
): string[] {
  const over: string[] = [];
  for (const preset of bank.presets) {
    for (const pz of preset.zones) {
      const presetValue = attenuationOf(pz, preset.globalZone);
      for (const zone of pz.instrument.zones) {
        const total = presetValue + attenuationOf(zone, pz.instrument.globalZone);
        if (total > MAX_ATTENUATION) {
          const message = `${preset.name} / ${zone.sample.name}: total attenuation ${total} exceeds ${MAX_ATTENUATION}`;
          if (!aboveMax.has(preset)) throw new Error(message);
          over.push(message);
        }
        if (total < 0 && nonNegative.has(preset)) {
          throw new Error(
            `${preset.name} / ${zone.sample.name}: total attenuation ${total} is below 0`,
          );
        }
      }
    }
  }
  return over;
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

function cloneWithRanges(
  bank: BasicSoundBank,
  source: BasicInstrument,
  offsets: readonly number[],
  suffix: string,
): BasicInstrument {
  const clone = new BasicInstrument();
  clone.name = `${source.name} ${suffix}`;
  clone.globalZone.copyFrom(source.globalZone);
  for (const zone of source.zones) {
    const range = zone.hasKeyRange ? zone.keyRange : source.globalZone.keyRange;
    const [min, max] = range.min < 0 ? [0, 127] : [range.min, range.max];
    const attenuation = attenuationOf(zone, source.globalZone);
    for (const band of rangeBands(offsets, min, max)) {
      const part = clone.createZone(zone.sample);
      part.copyFrom(zone);
      part.keyRange = { min: band.min, max: band.max };
      if (band.delta !== 0) part.setGenerator(ATTENUATION, attenuation + band.delta, false);
    }
  }
  bank.addInstruments(clone);
  return clone;
}

// Each corrected voice gets its own copies of its instruments, so the presets that share them keep their sound.
export function applyRangeCorrections(
  bank: BasicSoundBank,
  ranges: readonly RangeCorrection[],
): void {
  const corrected = new Set<BasicPreset>();
  for (const range of ranges) {
    const preset = voicePreset(bank, range);
    const where = `Voice MSB ${range.bankMSB} / PC ${range.program}`;
    if (corrected.has(preset)) throw new Error(`${where} has two range corrections`);
    corrected.add(preset);
    const offsets = rangeOffsets(range.keys, where);
    const clones = new Map<BasicInstrument, BasicInstrument>();
    for (const pz of preset.zones) {
      const source = pz.instrument;
      let clone = clones.get(source);
      if (!clone) {
        clone = cloneWithRanges(bank, source, offsets, `${range.bankMSB}:${range.program}`);
        clones.set(source, clone);
      }
      pz.instrument = clone;
    }
  }
  checkAttenuationRange(bank, corrected);
}

export interface AttenuationLimit {
  readonly min: number;
  readonly max: number;
}

const covers = (range: { min: number; max: number }, note: number) =>
  range.min < 0 || (range.min <= note && note <= range.max);

// The deltas a range correction may add at a note before a zone there leaves 0 to 1440. Like the
// build check, this looks at every instrument zone on the note, sounding through the preset or not.
export function rangeLimits(
  bank: BasicSoundBank,
): (voice: VoiceId, note: number) => AttenuationLimit {
  return (voice, note) => {
    const preset = voicePreset(bank, voice);
    let lowest = Infinity;
    let highest = -Infinity;
    for (const pz of preset.zones) {
      const presetValue = attenuationOf(pz, preset.globalZone);
      const global = pz.instrument.globalZone;
      for (const zone of pz.instrument.zones) {
        if (!covers(zone.hasKeyRange ? zone.keyRange : global.keyRange, note)) continue;
        const total = presetValue + attenuationOf(zone, global);
        lowest = Math.min(lowest, total);
        highest = Math.max(highest, total);
      }
    }
    return { min: -lowest, max: MAX_ATTENUATION - highest };
  };
}

function variationPreset(bank: BasicSoundBank, v: VariationCorrection): BasicPreset {
  const preset = bank.presets.find(
    (p) =>
      !p.isGMGSDrum &&
      p.bankMSB === 0 &&
      p.bankLSB === v.bankLSB &&
      p.program === v.program &&
      p.name.startsWith('XG '),
  );
  if (!preset) throw new Error(`XG variation LSB ${v.bankLSB} / PC ${v.program} not found`);
  return preset;
}

export function applyVariationCorrections(
  bank: BasicSoundBank,
  variations: readonly VariationCorrection[],
): string[] {
  const corrected = new Set<BasicPreset>();
  for (const v of variations) {
    const preset = variationPreset(bank, v);
    if (corrected.has(preset)) {
      throw new Error(`XG variation LSB ${v.bankLSB} / PC ${v.program} is corrected twice`);
    }
    corrected.add(preset);
    for (const pz of preset.zones) {
      if (v.attenuationDelta !== 0) {
        pz.setGenerator(
          ATTENUATION,
          attenuationOf(pz, preset.globalZone) + v.attenuationDelta,
          false,
        );
      }
      if (v.velocityAmountDelta !== 0) addVelocityAmount(bank, preset, pz, v.velocityAmountDelta);
    }
  }
  return checkAttenuationRange(bank, corrected, corrected);
}
