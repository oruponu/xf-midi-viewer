import { describe, expect, test } from 'bun:test';
import { calibrateVariationRanges } from './calibrateVariationRanges.ts';
import type { VariationRangeCalibrationInput } from './calibrateVariationRanges.ts';
import type { VariationId } from './calibrateVariations.ts';
import type { VariationRangeCorrection } from './corrections.ts';
import { ATTENUATION_PER_DB } from './fit.ts';
import { voiceLevelKey } from './levels.ts';
import type { LevelTable } from './levels.ts';

const NOTES = [36, 48];
const VELOCITIES = [40, 100];
const SHIFT = 18;
const MODULR: VariationId = { program: 39, bankLSB: 40, name: 'ModulrBa' };
const MELLO: VariationId = { program: 39, bankLSB: 6, name: 'MelloSB1' };

const base = (v: VariationId, note: number, velocity: number) =>
  -40 + v.bankLSB / 10 + note / 24 + 12 * Math.log2(velocity / 127);

const table = (
  variations: readonly VariationId[],
  f: (v: VariationId, note: number, velocity: number) => number,
): LevelTable => ({
  drums: [],
  voices: variations.map((v) => ({
    bankMSB: 0,
    bankLSB: v.bankLSB,
    program: v.program,
    levels: Object.fromEntries(
      NOTES.flatMap((n) => VELOCITIES.map((vel) => [voiceLevelKey(n, vel), f(v, n, vel)] as const)),
    ),
  })),
});

const measure =
  (variations: readonly VariationId[]) =>
  (ranges: readonly VariationRangeCorrection[]): LevelTable =>
    table(variations, (v, n, vel) => {
      const keys = ranges.find((r) => r.bankLSB === v.bankLSB && r.program === v.program)?.keys;
      const delta = keys?.find((k) => k.key === n)?.attenuationDelta ?? 0;
      return base(v, n, vel) - delta / ATTENUATION_PER_DB;
    });

const input = (
  variations: readonly VariationId[],
  offset: (v: VariationId, note: number) => number,
  overrides: Partial<VariationRangeCalibrationInput> = {},
): VariationRangeCalibrationInput => ({
  variations,
  notes: NOTES,
  velocities: VELOCITIES,
  reference: table(variations, (v, n, vel) => base(v, n, vel) + SHIFT + offset(v, n)),
  shiftDb: SHIFT,
  limit: () => ({ min: -1440, max: Infinity }),
  measure: measure(variations),
  ...overrides,
});

describe('calibrateVariationRanges', () => {
  test('fits each note of each variation in steps of the variation range step', () => {
    const result = calibrateVariationRanges(
      input([MODULR, MELLO], (v, n) => (v === MELLO ? 1.23 : n === 36 ? -2 : -2.04)),
    );
    expect(result.passed).toBe(true);
    expect(result.largestResidualDb).toBeLessThanOrEqual(0.2);
    expect(result.variationRanges).toEqual([
      {
        program: 39,
        bankLSB: 40,
        keys: [
          { key: 36, attenuationDelta: 50 },
          { key: 48, attenuationDelta: 50 },
        ],
      },
      {
        program: 39,
        bankLSB: 6,
        keys: [
          { key: 36, attenuationDelta: -30 },
          { key: 48, attenuationDelta: -30 },
        ],
      },
    ]);
  });

  test('names a variation by its name, LSB and program', () => {
    const variations = [MODULR, MELLO];
    expect(() =>
      calibrateVariationRanges(
        input(variations, () => 0, { reference: table([MODULR], (v, n, vel) => base(v, n, vel)) }),
      ),
    ).toThrow('MelloSB1 (LSB 6 / PC 39) is missing from the reference');
  });

  test('holds a note at the variation limit and reports it', () => {
    const result = calibrateVariationRanges(
      input([MODULR], () => 2, {
        limit: (v, note) =>
          v.bankLSB === 40 && note === 36
            ? { min: -12, max: Infinity }
            : { min: -1440, max: Infinity },
      }),
    );
    expect(result.variationRanges[0].keys).toEqual([
      { key: 36, attenuationDelta: -10 },
      { key: 48, attenuationDelta: -50 },
    ]);
    expect(result.outOfRange).toContain(
      'ModulrBa (LSB 40 / PC 39) note 36: needs -50 cB, allowed -10 to Infinity',
    );
    expect(result.passed).toBe(true);
  });
});
