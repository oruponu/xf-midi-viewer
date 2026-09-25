import { beforeAll, describe, expect, test } from 'bun:test';
import { SoundBankLoader, SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank, MIDIPatch } from 'spessasynth_core';
import { buildXgSoundBank, readSoundBank } from './build.ts';
import { SOURCE_SOUND_BANK_PATH } from './paths.ts';
import { XG_KITS } from './xgDrumKits.ts';
import { XG_SFX_VOICES } from './xgSfxVoices.ts';

SpessaLog.setLogLevel(false, false, false);

let source: BasicSoundBank;
let built: BasicSoundBank;

beforeAll(() => {
  const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
  source = SoundBankLoader.fromArrayBuffer(data.slice(0));
  built = SoundBankLoader.fromArrayBuffer(buildXgSoundBank(data));
});

const patch = (bankMSB: number, program: number, isGMGSDrum = false): MIDIPatch => ({
  bankMSB,
  bankLSB: 0,
  program,
  isGMGSDrum,
});

describe('buildXgSoundBank', () => {
  test('selects the XG kits by exact match in XG mode', () => {
    for (const kit of XG_KITS) {
      const preset = built.getPreset(patch(kit.bankMSB, kit.program), 'xg');
      expect([preset.name, preset.bankMSB, preset.program]).toEqual([
        `XG ${kit.name}`,
        kit.bankMSB,
        kit.program,
      ]);
    }
  });

  test('treats the XG drum kits as drums', () => {
    for (const kit of XG_KITS.filter((k) => k.bankMSB === 127)) {
      expect(built.getPreset(patch(127, kit.program), 'xg').isDrum).toBe(true);
    }
  });

  test('selects the SFX voices by exact match in XG mode', () => {
    for (const sfx of XG_SFX_VOICES) {
      const preset = built.getPreset(patch(64, sfx.program), 'xg');
      expect([preset.name, preset.bankMSB, preset.program]).toEqual([
        `XG ${sfx.name}`,
        64,
        sfx.program,
      ]);
    }
  });

  test('is recognized as an XG sound bank', () => {
    expect(built.isXGBank).toBe(true);
  });

  test('keeps every original preset and their GS and GM selection', () => {
    expect(built.presets.length).toBe(
      source.presets.length + XG_KITS.length + XG_SFX_VOICES.length,
    );
    for (const original of source.presets) {
      const p = patch(original.bankMSB, original.program, original.isGMGSDrum);
      for (const system of ['gs', 'gm'] as const) {
        expect(built.getPreset(p, system).name).toBe(source.getPreset(p, system).name);
      }
    }
  });

  test('leaves the XG drum kits silent outside notes 13 to 84', () => {
    const standard = built.getPreset(patch(127, 0), 'xg');
    for (const note of [0, 12, 85, 86, 87, 127]) {
      expect(standard.getVoiceParameters(note, 100)).toEqual([]);
    }
  });

  test('keeps the previous selection for XG kit programs not in the MU50', () => {
    for (const program of [5, 26, 127]) {
      for (const system of ['xg', 'gs'] as const) {
        const p = patch(127, program);
        expect(built.getPreset(p, system).name).toBe(source.getPreset(p, system).name);
      }
    }
  });

  test('selects the added XG presets for their bank and program even in GS mode (known limitation)', () => {
    expect(built.getPreset(patch(127, 0), 'gs').name).toBe('XG Standard Kit');
    expect(built.getPreset(patch(126, 0), 'gs').name).toBe('XG SFX 1');
    expect(built.getPreset(patch(64, 0), 'gs').name).toBe('XG Cutting Noise');
  });

  test('adds no samples', () => {
    expect(built.samples.length).toBe(source.samples.length);
  });
});
