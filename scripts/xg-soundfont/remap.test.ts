import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  GeneratorTypes,
  Modulator,
  ModulatorSource,
  ModulatorControllerSources,
  SoundBankLoader,
  SpessaLog,
} from 'spessasynth_core';
import type { BasicPreset, BasicSoundBank, VoiceParameters } from 'spessasynth_core';
import { gs, voice } from './mapping.ts';
import type { XgKit } from './mapping.ts';
import { SOURCE_SOUND_BANK_PATH } from './paths.ts';
import { buildKitPreset, buildSfxVoicePreset, findSourcePreset } from './remap.ts';
import { XG_KITS } from './xgDrumKits.ts';

SpessaLog.setLogLevel(false, false, false);

const VELOCITIES = [1, 40, 80, 127];
const KEY_DEPENDENT = new Set<number>([
  GeneratorTypes.overridingRootKey,
  GeneratorTypes.coarseTune,
  GeneratorTypes.fineTune,
  GeneratorTypes.holdVolEnv,
  GeneratorTypes.decayVolEnv,
  GeneratorTypes.holdModEnv,
  GeneratorTypes.decayModEnv,
]);

let bank: BasicSoundBank;

beforeEach(() => {
  const data = readFileSync(SOURCE_SOUND_BANK_PATH);
  bank = SoundBankLoader.fromArrayBuffer(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
});

function kit(notes: XgKit['notes'], base?: XgKit): XgKit {
  return { bankMSB: 127, program: 0, name: 'Test Kit', base, notes };
}

function effectiveKey(v: VoiceParameters, key: number): number {
  return v.generators[GeneratorTypes.keyNum] >= 0 ? v.generators[GeneratorTypes.keyNum] : key;
}

function pitchCents(v: VoiceParameters, key: number): number {
  const g = v.generators;
  const played = effectiveKey(v, key);
  const root =
    g[GeneratorTypes.overridingRootKey] >= 0
      ? g[GeneratorTypes.overridingRootKey]
      : v.sample.originalKey;
  return (
    (played - root) * g[GeneratorTypes.scaleTuning] +
    g[GeneratorTypes.coarseTune] * 100 +
    g[GeneratorTypes.fineTune]
  );
}

function envelope(
  v: VoiceParameters,
  key: number,
  keyNumberSource: number,
  target: number,
): number {
  return v.generators[target] + (60 - effectiveKey(v, key)) * v.generators[keyNumberSource];
}

function describeVoice(v: VoiceParameters, key: number): string {
  const others = [...v.generators].filter((_, type) => !KEY_DEPENDENT.has(type));
  return JSON.stringify({
    sample: v.sample.name,
    pitch: pitchCents(v, key),
    volHold: envelope(v, key, GeneratorTypes.keyNumToVolEnvHold, GeneratorTypes.holdVolEnv),
    volDecay: envelope(v, key, GeneratorTypes.keyNumToVolEnvDecay, GeneratorTypes.decayVolEnv),
    modHold: envelope(v, key, GeneratorTypes.keyNumToModEnvHold, GeneratorTypes.holdModEnv),
    modDecay: envelope(v, key, GeneratorTypes.keyNumToModEnvDecay, GeneratorTypes.decayModEnv),
    others,
    modulators: v.modulators.map((m) => m.toString()).sort(),
  });
}

function voicesOf(preset: BasicPreset, key: number, velocity: number): string[] {
  return preset
    .getVoiceParameters(key, velocity)
    .map((v) => describeVoice(v, key))
    .sort();
}

function expectSameSound(
  actual: BasicPreset,
  actualKey: number,
  expected: BasicPreset,
  expectedKey: number,
) {
  for (const velocity of VELOCITIES) {
    const expectedVoices = voicesOf(expected, expectedKey, velocity);
    expect(expectedVoices.length).toBeGreaterThan(0);
    expect(voicesOf(actual, actualKey, velocity)).toEqual(expectedVoices);
  }
}

function sourceZonesAt(program: number, key: number) {
  const source = findSourcePreset(bank, gs(program, key));
  return source.zones
    .filter((z) => key >= (z.hasKeyRange ? z.keyRange : source.globalZone.keyRange).min)
    .filter((z) => key <= (z.hasKeyRange ? z.keyRange : source.globalZone.keyRange).max)
    .flatMap((z) =>
      z.instrument.zones.filter(
        (iz) =>
          key >= (iz.hasKeyRange ? iz.keyRange : z.instrument.globalZone.keyRange).min &&
          key <= (iz.hasKeyRange ? iz.keyRange : z.instrument.globalZone.keyRange).max,
      ),
    );
}

describe('buildKitPreset', () => {
  test('sounds the same after moving a GS note to another key', () => {
    const preset = buildKitPreset(bank, kit({ 31: { name: 'Snare L', from: gs(0, 38) } }));
    expectSameSound(preset, 31, findSourcePreset(bank, gs(0, 38)), 38);
    expect(preset.getVoiceParameters(38, 100)).toEqual([]);
  });

  test('uses the XG bank and program for the kit', () => {
    const preset = buildKitPreset(bank, {
      bankMSB: 126,
      program: 1,
      name: 'SFX 2',
      notes: { 52: { name: 'Engine Start', from: gs(56, 63) } },
    });
    expect([preset.bankMSB, preset.bankLSB, preset.program, preset.isGMGSDrum]).toEqual([
      126,
      0,
      1,
      false,
    ]);
    expect(preset.name).toBe('XG SFX 2');
  });

  test('keeps exclusive classes after moving keys', () => {
    const preset = buildKitPreset(
      bank,
      kit({
        13: { name: 'Surdo Mute', from: gs(0, 86) },
        14: { name: 'Surdo Open', from: gs(0, 87) },
      }),
    );
    const source = findSourcePreset(bank, gs(0, 86));
    const groupsOf = (p: BasicPreset, key: number) =>
      p.getVoiceParameters(key, 100).map((v) => v.generators[GeneratorTypes.exclusiveClass]);
    expect(groupsOf(preset, 13)).toEqual(groupsOf(source, 86));
    expect(groupsOf(preset, 14)).toEqual(groupsOf(source, 87));
    expect(groupsOf(preset, 13)[0]).toBeGreaterThan(0);
    expect(groupsOf(preset, 13)).toEqual(groupsOf(preset, 14));
  });

  test('keeps the sound of each source kit when mixing GS kits', () => {
    const preset = buildKitPreset(
      bank,
      kit({
        36: { name: 'BD Rock', from: gs(16, 36) },
        38: { name: 'Brush Slap', from: gs(40, 39) },
        40: { name: 'SD Rock H', from: gs(16, 40) },
      }),
    );
    expectSameSound(preset, 36, findSourcePreset(bank, gs(16, 36)), 36);
    expectSameSound(preset, 38, findSourcePreset(bank, gs(40, 39)), 39);
    expectSameSound(preset, 40, findSourcePreset(bank, gs(16, 40)), 40);
  });

  test('moves notes from melodic presets', () => {
    const preset = buildKitPreset(bank, kit({ 52: { name: 'FL.Key Click', from: voice(1, 121) } }));
    expectSameSound(preset, 52, findSourcePreset(bank, voice(1, 121)), 60);
  });

  test('keeps key-scaled envelopes as long as on the source key', () => {
    for (const zone of sourceZonesAt(0, 38)) {
      zone.setGenerator(GeneratorTypes.keyNumToVolEnvDecay, 50, false);
      zone.setGenerator(GeneratorTypes.keyNumToModEnvHold, -30, false);
    }
    const preset = buildKitPreset(bank, kit({ 31: { name: 'Snare L', from: gs(0, 38) } }));
    expectSameSound(preset, 31, findSourcePreset(bank, gs(0, 38)), 38);
  });

  test('compensates with tuning when the shifted root key is out of range', () => {
    for (const zone of sourceZonesAt(0, 38))
      zone.setGenerator(GeneratorTypes.overridingRootKey, 2, false);
    const preset = buildKitPreset(bank, kit({ 31: { name: 'Snare L', from: gs(0, 38) } }));
    expectSameSound(preset, 31, findSourcePreset(bank, gs(0, 38)), 38);
    for (const v of preset.getVoiceParameters(31, 100)) {
      expect(v.generators[GeneratorTypes.overridingRootKey]).toBe(2);
    }
  });

  test('leaves pitch and envelopes of fixed-key zones unchanged', () => {
    for (const zone of sourceZonesAt(0, 38)) {
      zone.setGenerator(GeneratorTypes.keyNum, 64, false);
      zone.setGenerator(GeneratorTypes.keyNumToVolEnvDecay, 50, false);
    }
    const preset = buildKitPreset(bank, kit({ 31: { name: 'Snare L', from: gs(0, 38) } }));
    expectSameSound(preset, 31, findSourcePreset(bank, gs(0, 38)), 38);
    const source = findSourcePreset(bank, gs(0, 38));
    const raw = (p: BasicPreset, key: number) =>
      p
        .getVoiceParameters(key, 100)
        .map((v) => [
          v.generators[GeneratorTypes.overridingRootKey],
          v.generators[GeneratorTypes.decayVolEnv],
        ])
        .sort();
    expect(raw(preset, 31)).toEqual(raw(source, 38));
  });

  test('leaves notes without a source silent', () => {
    const preset = buildKitPreset(
      bank,
      kit({ 90: { name: 'Ghost', from: null, reason: 'no-substitute' } }),
    );
    expect(preset.getVoiceParameters(90, 100)).toEqual([]);
  });

  test('inherits base notes and overrides only the listed ones', () => {
    const base = kit({
      38: { name: 'Snare M', from: gs(0, 38) },
      40: { name: 'Snare H', from: gs(0, 40) },
      42: { name: 'Hi-Hat Closed', from: gs(0, 42) },
    });
    const preset = buildKitPreset(bank, {
      ...kit(
        {
          38: { name: 'SD Room L', from: gs(8, 38) },
          40: { name: 'X', from: null, reason: 'no-substitute' },
        },
        base,
      ),
      program: 8,
    });
    expectSameSound(preset, 38, findSourcePreset(bank, gs(8, 38)), 38);
    expect(preset.getVoiceParameters(40, 100)).toEqual([]);
    expectSameSound(preset, 42, findSourcePreset(bank, gs(0, 42)), 42);
  });

  test('throws when a mapping points to a missing preset or key', () => {
    expect(() => buildKitPreset(bank, kit({ 31: { name: 'X', from: gs(99, 38) } }))).toThrow(
      '音色がありません',
    );
    expect(() => buildKitPreset(bank, kit({ 31: { name: 'X', from: gs(0, 10) } }))).toThrow(
      '音がありません',
    );
  });

  test('refuses to move zones with key-number modulators', () => {
    const [zone] = sourceZonesAt(0, 38);
    zone.addModulators(
      new Modulator(
        ModulatorSource.fromSourceEnum(ModulatorControllerSources.noteOnKeyNum),
        ModulatorSource.fromSourceEnum(ModulatorControllerSources.noController),
        GeneratorTypes.pan,
        100,
        0,
      ),
    );
    expect(() => buildKitPreset(bank, kit({ 31: { name: 'Snare L', from: gs(0, 38) } }))).toThrow(
      'ノート番号で変化するモジュレーター',
    );
    expect(() =>
      buildKitPreset(bank, kit({ 38: { name: 'Snare M', from: gs(0, 38) } })),
    ).not.toThrow();
  });
});

describe('buildSfxVoicePreset', () => {
  test('sounds the same as the source preset', () => {
    const preset = buildSfxVoicePreset(bank, { program: 32, name: 'Rain', from: voice(1, 122) });
    expect([preset.bankMSB, preset.bankLSB, preset.program, preset.isGMGSDrum]).toEqual([
      64,
      0,
      32,
      false,
    ]);
    expect(preset.name).toBe('XG Rain');
    const source = findSourcePreset(bank, voice(1, 122));
    for (const key of [36, 60, 84]) expectSameSound(preset, key, source, key);
  });

  test('creates an empty preset when there is no source', () => {
    const preset = buildSfxVoicePreset(bank, {
      program: 54,
      name: 'Ghost',
      from: null,
      reason: 'no-substitute',
    });
    expect(preset.program).toBe(54);
    expect(preset.zones).toEqual([]);
    expect(preset.getVoiceParameters(60, 100)).toEqual([]);
  });
});

describe('XG_KITS', () => {
  test('builds every kit', () => {
    for (const xgKit of XG_KITS) expect(() => buildKitPreset(bank, xgKit)).not.toThrow();
  });
});
