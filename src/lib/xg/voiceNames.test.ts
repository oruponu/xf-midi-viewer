import { describe, expect, test } from 'bun:test';
import { XG_NORMAL_VOICES, XG_SFX_VOICES } from './voiceList.ts';
import { isXgDrumKit, voiceName } from './voiceNames.ts';

const normal = (bankMSB: number, bankLSB: number, program: number) => ({
  bankMSB,
  bankLSB,
  program,
  isDrum: false,
});

const drum = (bankMSB: number, program: number) => ({
  bankMSB,
  bankLSB: 0,
  program,
  isDrum: true,
});

describe('voiceName', () => {
  test('names the first and last GM voices', () => {
    expect(voiceName(normal(0, 0, 0))).toBe('GrandPno');
    expect(voiceName(normal(0, 0, 127))).toBe('Gunshot');
  });

  test('looks up a variation voice by bank LSB', () => {
    expect(voiceName(normal(0, 18, 0))).toBe('MelloGrP');
    expect(voiceName(normal(0, 40, 48))).toBe('Orchestr');
  });

  test('falls back to bank LSB 0 for an unknown variation', () => {
    expect(voiceName(normal(0, 99, 0))).toBe('GrandPno');
    expect(voiceName(normal(0, 117, 27))).toBe('CleanGtr');
  });

  test('has no sound for a bank MSB other than the XG normal and SFX banks', () => {
    expect(voiceName(normal(8, 18, 0))).toBeNull();
    expect(voiceName(normal(127, 0, 0))).toBeNull();
  });

  test('looks up SFX voices and has no sound for an empty slot', () => {
    expect(voiceName(normal(64, 0, 32))).toBe('Rain');
    expect(voiceName(normal(64, 0, 7))).toBeNull();
  });

  test('names drum kits', () => {
    expect(voiceName(drum(127, 0))).toBe('Standard Kit');
    expect(voiceName(drum(127, 8))).toBe('Room Kit');
    expect(voiceName(drum(127, 48))).toBe('Classic Kit');
    expect(voiceName(drum(0, 0))).toBe('Standard Kit');
  });

  test('names SFX kits and has no sound for an unknown one', () => {
    expect(voiceName(drum(126, 1))).toBe('SFX 2');
    expect(voiceName(drum(126, 2))).toBeNull();
  });
});

describe('isXgDrumKit', () => {
  test('accepts only the XG Level 1 drum kits', () => {
    expect(isXgDrumKit(0)).toBe(true);
    expect(isXgDrumKit(25)).toBe(true);
    expect(isXgDrumKit(2)).toBe(false);
    expect(isXgDrumKit(86)).toBe(false);
  });
});

describe('XG voice list', () => {
  test('has the XG minimum requirement voices without duplicates', () => {
    expect(XG_NORMAL_VOICES).toHaveLength(440);
    expect(XG_SFX_VOICES).toHaveLength(39);
    const normalKeys = new Set(XG_NORMAL_VOICES.map(([program, lsb]) => `${program}/${lsb}`));
    expect(normalKeys.size).toBe(XG_NORMAL_VOICES.length);
    const sfxKeys = new Set(XG_SFX_VOICES.map(([program]) => program));
    expect(sfxKeys.size).toBe(XG_SFX_VOICES.length);
  });

  test('uses the spelling and entries of the XG specification', () => {
    expect(voiceName(normal(0, 8, 48))).toBe('SlowStr');
    expect(voiceName(normal(0, 96, 56))).toBe('FluglHrn');
  });

  test('has a bank LSB 0 voice for every program and only program numbers 0-127', () => {
    for (let program = 0; program < 128; program += 1) {
      expect(XG_NORMAL_VOICES.some(([p, lsb]) => p === program && lsb === 0)).toBe(true);
    }
    for (const [program] of [...XG_NORMAL_VOICES, ...XG_SFX_VOICES]) {
      expect(program).toBeGreaterThanOrEqual(0);
      expect(program).toBeLessThanOrEqual(127);
    }
  });
});
