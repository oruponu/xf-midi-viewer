import { describe, expect, test } from 'bun:test';
import { resolveKitNotes, voice } from './mapping.ts';
import { XG_KITS } from './xgDrumKits.ts';
import { XG_SFX_VOICES } from './xgSfxVoices.ts';
import { KEPT_IN_GS_BANKS, XG_VARIATION_VOICES, variationVoices } from './xgVariationVoices.ts';

describe('XG kit tables', () => {
  test('Standard Kit covers notes 13 to 84', () => {
    const notes = [...resolveKitNotes(XG_KITS[0]).keys()].sort((a, b) => a - b);
    expect(notes).toEqual(Array.from({ length: 72 }, (_, i) => 13 + i));
  });

  test('has the nine MU50 drum kits, each within notes 13 to 84', () => {
    const drums = XG_KITS.filter((kit) => kit.bankMSB === 127);
    expect(drums.map((kit) => kit.program)).toEqual([0, 1, 8, 16, 24, 25, 32, 40, 48]);
    for (const kit of drums) {
      expect([...resolveKitNotes(kit).keys()].every((note) => note >= 13 && note <= 84)).toBe(true);
    }
  });

  test('has two SFX kits without a base', () => {
    const sfx = XG_KITS.filter((kit) => kit.bankMSB === 126);
    expect(sfx.map((kit) => [kit.program, kit.base])).toEqual([
      [0, undefined],
      [1, undefined],
    ]);
  });
});

describe('XG SFX voice table', () => {
  test('has the 42 MU50 voices with unique programs', () => {
    const programs = XG_SFX_VOICES.map((sfx) => sfx.program);
    expect(programs.length).toBe(42);
    expect(new Set(programs).size).toBe(42);
  });
});

describe('XG variation voice table', () => {
  test('lists every XG Level 1 variation except the three kept in GS banks', () => {
    expect(XG_VARIATION_VOICES.length).toBe(309);
    expect(XG_VARIATION_VOICES.every((v) => v.bankLSB !== 0)).toBe(true);
    const ids = XG_VARIATION_VOICES.map((v) => `${v.program}/${v.bankLSB}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(XG_VARIATION_VOICES).toContainEqual({
      program: 25,
      bankLSB: 16,
      name: 'SteelGt2',
      from: voice(0, 25),
    });
    expect(XG_VARIATION_VOICES).toContainEqual({
      program: 81,
      bankLSB: 18,
      name: 'DynaSaw',
      from: voice(0, 81),
    });
    for (const [program, bankLSB] of KEPT_IN_GS_BANKS) {
      expect(ids).not.toContain(`${program}/${bankLSB}`);
    }
    expect(KEPT_IN_GS_BANKS.map(([program, bankLSB]) => `${program}/${bankLSB}`)).toEqual([
      '81/8',
      '48/8',
      '80/8',
    ]);
  });

  test('throws when a variation to keep is not an XG voice', () => {
    expect(() => variationVoices([[81, 18, 'DynaSaw']], [[81, 8]])).toThrow('LSB 8 / PC 81');
  });
});
