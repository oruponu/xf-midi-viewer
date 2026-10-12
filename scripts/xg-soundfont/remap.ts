import {
  BasicInstrument,
  BasicPreset,
  GeneratorLimits,
  GeneratorTypes,
  Modulator,
  ModulatorControllerSources,
} from 'spessasynth_core';
import type {
  BasicInstrumentZone,
  BasicPresetZone,
  BasicSoundBank,
  BasicZone,
  GeneratorType,
  GenericRange,
} from 'spessasynth_core';
import { describeSource, resolveKitNotes } from './mapping.ts';
import type { SourceNote, XgKit, XgSfxVoice, XgVariationVoice } from './mapping.ts';

const KEY_NUMBER_ENVELOPES: readonly (readonly [GeneratorType, GeneratorType])[] = [
  [GeneratorTypes.keyNumToVolEnvHold, GeneratorTypes.holdVolEnv],
  [GeneratorTypes.keyNumToVolEnvDecay, GeneratorTypes.decayVolEnv],
  [GeneratorTypes.keyNumToModEnvHold, GeneratorTypes.holdModEnv],
  [GeneratorTypes.keyNumToModEnvDecay, GeneratorTypes.decayModEnv],
];

interface Layer {
  readonly instrument: BasicInstrument;
  readonly presetZone: BasicPresetZone;
}

export function findSourcePreset(bank: BasicSoundBank, source: SourceNote): BasicPreset {
  const preset = bank.presets.find((p) =>
    source.drum
      ? p.isGMGSDrum && p.program === source.program
      : !p.isGMGSDrum &&
        p.bankMSB === source.bankMSB &&
        p.bankLSB === 0 &&
        p.program === source.program,
  );
  if (!preset) throw new Error(`${describeSource(source)}: 音色がありません`);
  return preset;
}

export function buildKitPreset(bank: BasicSoundBank, kit: XgKit): BasicPreset {
  const preset = createPreset(bank, `XG ${kit.name}`, kit.bankMSB, kit.program);
  const layers = new Map<BasicPresetZone, Layer>();
  const notes = [...resolveKitNotes(kit)].sort(([a], [b]) => a - b);
  for (const [note, mapped] of notes) {
    if (!mapped.from) continue;
    const source = findSourcePreset(bank, mapped.from);
    const key = mapped.from.note;
    const lowest = mapped.lowestLayer;
    let found = false;
    let lowestFound = false;
    for (const sourceZone of source.zones) {
      if (!inRange(keyRangeOf(sourceZone, source.globalZone), key)) continue;
      const instrument = sourceZone.instrument;
      let zones = instrument.zones.filter((z) =>
        inRange(keyRangeOf(z, instrument.globalZone), key),
      );
      if (zones.length === 0) continue;
      if (
        note !== key &&
        usesKeyNumber([source.globalZone, sourceZone, instrument.globalZone, ...zones])
      ) {
        throw new Error(
          `${kit.name} のノート ${note}: ${describeSource(mapped.from)} はノート番号で変化するモジュレーターを持つため移せません`,
        );
      }
      if (lowest !== undefined) {
        const presetRange = velocityRangeOf(sourceZone, source.globalZone);
        if (presetRange.min > 0 || presetRange.max < 127) {
          throw new Error(
            `${kit.name} note ${note}: the source preset limits velocities, so its layers cannot be extended`,
          );
        }
        for (const z of zones) {
          const { min, max } = velocityRangeOf(z, instrument.globalZone);
          if (min < lowest && lowest <= max) {
            throw new Error(
              `${kit.name} note ${note}: velocity layer ${min}-${max} crosses lowestLayer ${lowest}`,
            );
          }
        }
        zones = zones.filter((z) => velocityRangeOf(z, instrument.globalZone).max >= lowest);
        if (zones.length === 0) continue;
      }
      let layer = layers.get(sourceZone);
      if (!layer) {
        layer = createLayer(bank, preset, source, sourceZone, kit);
        layers.set(sourceZone, layer);
      }
      for (const zone of zones) {
        const moved = moveZone(zone, instrument.globalZone, layer, key, note);
        const range = velocityRangeOf(zone, instrument.globalZone);
        if (range.min === lowest) {
          moved.velRange = { min: 0, max: range.max };
          lowestFound = true;
        }
      }
      found = true;
    }
    if (lowest !== undefined && !lowestFound) {
      throw new Error(
        `${kit.name} note ${note}: no velocity layer starts at lowestLayer ${lowest}`,
      );
    }
    if (!found)
      throw new Error(
        `${kit.name} のノート ${note}: ${describeSource(mapped.from)} に音がありません`,
      );
  }
  return preset;
}

export function buildSfxVoicePreset(bank: BasicSoundBank, sfx: XgSfxVoice): BasicPreset {
  const preset = createPreset(bank, `XG ${sfx.name}`, 64, sfx.program);
  if (!sfx.from) return preset;
  const source = findSourcePreset(bank, sfx.from);
  preset.globalZone.copyFrom(source.globalZone);
  for (const sourceZone of source.zones)
    preset.createZone(sourceZone.instrument).copyFrom(sourceZone);
  return preset;
}

export function buildVariationVoicePreset(
  bank: BasicSoundBank,
  variation: XgVariationVoice,
): BasicPreset {
  const preset = createPreset(
    bank,
    `XG ${variation.name}`,
    0,
    variation.program,
    variation.bankLSB,
  );
  copyZones(preset, findSourcePreset(bank, variation.from));
  return preset;
}

export function buildGsFallbackPreset(
  bank: BasicSoundBank,
  bankMSB: number,
  source: SourceNote,
): BasicPreset {
  const base = findSourcePreset(bank, source);
  const preset = createPreset(bank, base.name, bankMSB, source.program);
  copyZones(preset, base);
  return preset;
}

function copyZones(preset: BasicPreset, source: BasicPreset): void {
  preset.globalZone.copyFrom(source.globalZone);
  for (const sourceZone of source.zones)
    preset.createZone(sourceZone.instrument).copyFrom(sourceZone);
}

function createPreset(
  bank: BasicSoundBank,
  name: string,
  bankMSB: number,
  program: number,
  bankLSB = 0,
): BasicPreset {
  const preset = new BasicPreset(bank);
  preset.name = name;
  preset.bankMSB = bankMSB;
  preset.bankLSB = bankLSB;
  preset.program = program;
  preset.isGMGSDrum = false;
  return preset;
}

function createLayer(
  bank: BasicSoundBank,
  preset: BasicPreset,
  source: BasicPreset,
  sourceZone: BasicPresetZone,
  kit: XgKit,
): Layer {
  const instrument = new BasicInstrument();
  instrument.name = `XG${kit.bankMSB}-${kit.program} ${sourceZone.instrument.name}`.slice(0, 20);
  instrument.globalZone.copyFrom(sourceZone.instrument.globalZone);
  bank.addInstruments(instrument);

  const presetZone = preset.createZone(instrument);
  presetZone.copyFrom(source.globalZone);
  for (const generator of sourceZone.generators) {
    presetZone.setGenerator(generator.type, generator.value, false);
  }
  presetZone.modulators = sourceZone.modulators.map((m) => Modulator.copyFrom(m));
  for (const modulator of source.globalZone.modulators) {
    if (!presetZone.modulators.some((m) => Modulator.isIdentical(m, modulator))) {
      presetZone.modulators.push(Modulator.copyFrom(modulator));
    }
  }
  presetZone.keyRange = { min: -1, max: 127 };
  presetZone.velRange = {
    ...(sourceZone.hasVelRange ? sourceZone.velRange : source.globalZone.velRange),
  };
  return { instrument, presetZone };
}

function moveZone(
  source: BasicInstrumentZone,
  sourceGlobal: BasicZone,
  layer: Layer,
  from: number,
  to: number,
): BasicInstrumentZone {
  const zone = layer.instrument.createZone(source.sample);
  zone.copyFrom(source);
  zone.keyRange = { min: to, max: to };
  const shift = to - from;
  if (shift === 0) return zone;

  const instrumentValue = (type: GeneratorType) =>
    zone.getGenerator(type, sourceGlobal.getGenerator(type, GeneratorLimits[type].def));
  const presetValue = (type: GeneratorType) => layer.presetZone.getGenerator(type, 0);

  if (instrumentValue(GeneratorTypes.keyNum) >= 0) return zone;

  const overridden = instrumentValue(GeneratorTypes.overridingRootKey);
  const root = (overridden >= 0 ? overridden : source.sample.originalKey) + shift;
  if (root >= 0 && root <= 127) {
    zone.setGenerator(GeneratorTypes.overridingRootKey, root, false);
  } else {
    const scale =
      instrumentValue(GeneratorTypes.scaleTuning) + presetValue(GeneratorTypes.scaleTuning);
    const tuning =
      instrumentValue(GeneratorTypes.coarseTune) * 100 + instrumentValue(GeneratorTypes.fineTune);
    zone.fineTuning = tuning - shift * scale;
  }

  for (const [keyNumberSource, envelope] of KEY_NUMBER_ENVELOPES) {
    const amount = instrumentValue(keyNumberSource) + presetValue(keyNumberSource);
    if (amount !== 0)
      zone.setGenerator(envelope, instrumentValue(envelope) + shift * amount, false);
  }
  return zone;
}

function keyRangeOf(zone: BasicZone, global: BasicZone): GenericRange {
  return zone.hasKeyRange ? zone.keyRange : global.keyRange;
}

function velocityRangeOf(zone: BasicZone, global: BasicZone): GenericRange {
  const range = zone.hasVelRange ? zone.velRange : global.velRange;
  return { min: Math.max(0, range.min), max: range.max };
}

function inRange(range: GenericRange, value: number): boolean {
  return value >= range.min && value <= range.max;
}

function usesKeyNumber(zones: readonly BasicZone[]): boolean {
  return zones.some((zone) =>
    zone.modulators.some((m) =>
      [m.primarySource, m.secondarySource].some(
        (s) => !s.isCC && s.index === ModulatorControllerSources.noteOnKeyNum,
      ),
    ),
  );
}
