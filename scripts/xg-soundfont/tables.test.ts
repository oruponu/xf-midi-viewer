import { describe, expect, test } from 'bun:test';
import { resolveKitNotes } from './mapping.ts';
import { XG_KITS } from './xgDrumKits.ts';

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
