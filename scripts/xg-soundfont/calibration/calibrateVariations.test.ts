import { describe, expect, test } from 'bun:test';
import {
  calibrateVariations,
  checkCorrections,
  checkVariationChanges,
  variationChanges,
  variationFitCorrections,
} from './calibrateVariations.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import type { VariationCorrection } from './corrections.ts';
import { ATTENUATION_PER_DB, DB_PER_DOUBLING_PER_AMOUNT } from './fit.ts';
import { voiceLevelKey } from './levels.ts';
import type { Level, LevelTable } from './levels.ts';

const NOTES = [36, 48, 60, 72, 84];
const VELOCITIES = [40, 64, 100, 127];
const DYNASAW = { program: 81, bankLSB: 18, name: 'DynaSaw' };
const SAW2 = { program: 81, bankLSB: 6, name: 'Saw 2' };

const levels = (f: (note: number, velocity: number) => Level) =>
  Object.fromEntries(
    NOTES.flatMap((n) => VELOCITIES.map((v) => [voiceLevelKey(n, v), f(n, v)] as const)),
  );
const base = (note: number, velocity: number) => -40 + note / 24 + 12 * Math.log2(velocity / 127);
const tilt = (velocity: number) => Math.log2(velocity / 127);

// The reference sits 18 dB above the synth; only the variation-minus-base difference matters.
function reference(diffs: Record<number, { level: number; slope: number } | null>): LevelTable {
  return {
    drums: [],
    voices: [
      { bankMSB: 0, program: 81, levels: levels((n, v) => base(n, v) + 18) },
      ...Object.entries(diffs).map(([lsb, d]) => ({
        bankMSB: 0,
        bankLSB: Number(lsb),
        program: 81,
        levels: levels((n, v) =>
          d === null ? null : base(n, v) + 18 + d.level + d.slope * tilt(v),
        ),
      })),
    ],
  };
}

// A synth whose variations start as copies of the base voice.
function synth(
  lsbs: number[],
  options: { ignoreAttenuation?: boolean; baseSilentAt?: string } = {},
) {
  let calls = 0;
  const measure = (variations: readonly VariationCorrection[]): LevelTable => {
    calls++;
    return {
      drums: [],
      voices: [
        {
          bankMSB: 0,
          program: 81,
          levels: levels((n, v) =>
            voiceLevelKey(n, v) === options.baseSilentAt ? -90 : base(n, v),
          ),
        },
        ...lsbs.map((lsb) => {
          const c = variations.find((x) => x.bankLSB === lsb)!;
          const attenuation = options.ignoreAttenuation ? 0 : c.attenuationDelta;
          return {
            bankMSB: 0,
            bankLSB: lsb,
            program: 81,
            levels: levels(
              (n, v) =>
                base(n, v) -
                attenuation / ATTENUATION_PER_DB +
                c.velocityAmountDelta * DB_PER_DOUBLING_PER_AMOUNT * tilt(v),
            ),
          };
        }),
      ],
    };
  };
  return { measure, calls: () => calls };
}

describe('calibrateVariations', () => {
  test('fits the velocity sensitivity and the level to the difference from the base voice', () => {
    const { measure } = synth([18]);
    const result = calibrateVariations({
      variations: [DYNASAW],
      reference: reference({ 18: { level: 8, slope: -2 } }),
      measure,
    });
    expect(result.passed).toBe(true);
    expect(result.unmeasured).toEqual([]);
    const [c] = result.variations;
    expect([c.program, c.bankLSB]).toEqual([81, 18]);
    expect(c.velocityAmountDelta).toBe(Math.round(-2 / DB_PER_DOUBLING_PER_AMOUNT));
    expect(c.attenuationDelta).toBeLessThan(-150);
    expect(result.means.max).toBeLessThanOrEqual(0.1);
  });

  test('fails and reports a variation without measurable points, leaving it at zero', () => {
    const { measure } = synth([18, 6]);
    const result = calibrateVariations({
      variations: [DYNASAW, SAW2],
      reference: reference({ 18: { level: 8, slope: 0 }, 6: null }),
      measure,
    });
    expect(result.passed).toBe(false);
    expect(result.means.max).toBeLessThanOrEqual(0.1);
    expect(result.unmeasured).toEqual(['Saw 2 (LSB 6 / PC 81)']);
    expect(result.variations.find((c) => c.bankLSB === 6)).toEqual({
      program: 81,
      bankLSB: 6,
      attenuationDelta: 0,
      velocityAmountDelta: 0,
    });
  });

  test('reports the mean residual of each measured variation', () => {
    const { measure } = synth([18, 6]);
    const result = calibrateVariations({
      variations: [DYNASAW, SAW2],
      reference: reference({ 18: { level: 8, slope: -2 }, 6: null }),
      measure,
    });
    expect(result.residuals.map(({ program, bankLSB }) => [program, bankLSB])).toEqual([[81, 18]]);
    expect(Math.abs(result.residuals[0].meanDb)).toBeLessThanOrEqual(0.1);
  });

  test('drops a point when the base voice is silent there', () => {
    const { measure } = synth([18], { baseSilentAt: '36/40' });
    const result = calibrateVariations({
      variations: [DYNASAW],
      reference: reference({ 18: { level: 3, slope: 0 } }),
      measure,
    });
    expect(result.passed).toBe(true);
    expect(result.points.count).toBe(NOTES.length * VELOCITIES.length - 1);
  });

  test('fails when the level cannot reach the target', () => {
    const { measure, calls } = synth([18], { ignoreAttenuation: true });
    const result = calibrateVariations({
      variations: [DYNASAW],
      reference: reference({ 18: { level: 8, slope: 0 } }),
      measure,
      maxIterations: 3,
    });
    expect(result.passed).toBe(false);
    expect(calls()).toBe(2 + 3);
  });

  test('stops when a voice is missing from the reference or the measurement', () => {
    const { measure } = synth([18]);
    const noVariation: LevelTable = {
      drums: [],
      voices: reference({ 18: { level: 8, slope: 0 } }).voices.filter((v) => !v.bankLSB),
    };
    expect(() =>
      calibrateVariations({ variations: [DYNASAW], reference: noVariation, measure }),
    ).toThrow('DynaSaw (LSB 18 / PC 81): LSB 18 / PC 81 is missing from the reference');
    expect(() =>
      calibrateVariations({
        variations: [DYNASAW],
        reference: reference({ 18: { level: 8, slope: 0 } }),
        measure: (variations) => ({
          ...measure(variations),
          voices: measure(variations).voices.filter((v) => v.bankLSB),
        }),
      }),
    ).toThrow('DynaSaw (LSB 18 / PC 81): LSB 0 / PC 81 is missing from the measurement');
  });

  test('stops when a table has no points or misses a point', () => {
    const { measure } = synth([18]);
    const full = reference({ 18: { level: 8, slope: 0 } });
    const emptyVariation: LevelTable = {
      drums: [],
      voices: full.voices.map((v) => (v.bankLSB ? { ...v, levels: {} } : v)),
    };
    expect(() =>
      calibrateVariations({ variations: [DYNASAW], reference: emptyVariation, measure }),
    ).toThrow('DynaSaw (LSB 18 / PC 81) has no points in the reference');
    const withoutPoint = (l: Readonly<Record<string, Level>>) =>
      Object.fromEntries(Object.entries(l).filter(([key]) => key !== '60/100'));
    expect(() =>
      calibrateVariations({
        variations: [DYNASAW],
        reference: full,
        measure: (variations) => {
          const table = measure(variations);
          const voices = table.voices.map((v) =>
            v.bankLSB ? v : { ...v, levels: withoutPoint(v.levels) },
          );
          return { ...table, voices };
        },
      }),
    ).toThrow(
      'DynaSaw (LSB 18 / PC 81): point 60/100 is missing from the measurement of the base voice',
    );
  });

  test('stops when a point of a variation can no longer be measured', () => {
    let first = true;
    const { measure } = synth([18]);
    expect(() =>
      calibrateVariations({
        variations: [DYNASAW],
        reference: reference({ 18: { level: 8, slope: 0 } }),
        measure: (variations) => {
          const table = measure(variations);
          if (first) {
            first = false;
            return table;
          }
          const voices = table.voices.map((v) =>
            v.bankLSB === 18 ? { ...v, levels: { ...v.levels, '60/100': null } } : v,
          );
          return { ...table, voices };
        },
      }),
    ).toThrow('DynaSaw (LSB 18 / PC 81) point 60/100 can no longer be measured');
  });
});

describe('variationChanges', () => {
  const ref = reference({ 18: { level: 8, slope: -2 }, 6: null });
  const fitted = () => {
    const { measure } = synth([18, 6]);
    const result = calibrateVariations({ variations: [DYNASAW, SAW2], reference: ref, measure });
    return { measure, variations: result.variations };
  };

  test('finds no change when the corrections stay the same', () => {
    const { measure, variations } = fitted();
    const changes = variationChanges(
      [DYNASAW, SAW2],
      ref,
      measure(variations),
      measure(variations),
    );
    expect(changes.map((c) => [c.program, c.bankLSB])).toEqual([[81, 18]]);
    expect(changes[0].afterDb).toBe(changes[0].beforeDb);
    expect(Math.abs(changes[0].beforeDb)).toBeLessThanOrEqual(0.1);
  });

  test('shows the residual moving with the level of the variation', () => {
    const { measure, variations } = fitted();
    const quieter = variations.map((c) => ({ ...c, attenuationDelta: c.attenuationDelta + 25 }));
    const [change] = variationChanges([DYNASAW], ref, measure(variations), measure(quieter));
    expect(change.afterDb! - change.beforeDb).toBeCloseTo(1, 2);
  });

  test('reports a variation that can no longer be measured', () => {
    const { measure, variations } = fitted();
    const after = measure(variations);
    const silent: LevelTable = {
      ...after,
      voices: after.voices.map((v) =>
        v.bankLSB === 18
          ? { ...v, levels: Object.fromEntries(Object.keys(v.levels).map((k) => [k, -90])) }
          : v,
      ),
    };
    const [change] = variationChanges([DYNASAW], ref, measure(variations), silent);
    expect(change.afterDb).toBeNull();
    expect(change.lostPoints).toBeGreaterThan(0);
  });

  test('counts the points lost and compares the rest', () => {
    const { measure, variations } = fitted();
    const quieter = variations.map((c) => ({ ...c, attenuationDelta: c.attenuationDelta + 25 }));
    const after = measure(quieter);
    const fewer: LevelTable = {
      ...after,
      voices: after.voices.map((v) =>
        v.bankLSB === 18 ? { ...v, levels: { ...v.levels, '36/40': -90 } } : v,
      ),
    };
    const [all] = variationChanges([DYNASAW], ref, measure(variations), after);
    const [some] = variationChanges([DYNASAW], ref, measure(variations), fewer);
    expect(all.lostPoints).toBe(0);
    expect(some.lostPoints).toBe(1);
    expect(some.afterDb! - some.beforeDb).toBeCloseTo(all.afterDb! - all.beforeDb, 6);
  });
});

describe('checkVariationChanges', () => {
  const change = (beforeDb: number, afterDb: number | null, lostPoints = 0) => ({
    program: 81,
    bankLSB: 18,
    beforeDb,
    afterDb,
    lostPoints,
  });

  test('passes a change within the 0.1 dB step of the synth', () => {
    const result = checkVariationChanges([change(0.02, 0.12), change(0, -0.1)]);
    expect(result.passed).toBe(true);
    expect(result.moved).toEqual([]);
  });

  test('fails a change above 0.1 dB and a variation with no points left', () => {
    const result = checkVariationChanges([change(0, 0.11), change(0, null, 20), change(0, 0)]);
    expect(result.passed).toBe(false);
    expect(result.moved).toEqual([change(0, 0.11)]);
    expect(result.lost).toEqual([change(0, null, 20)]);
  });

  test('reports a variation that lost some of its points without failing', () => {
    const result = checkVariationChanges([change(0, 0.02, 2)]);
    expect(result.passed).toBe(true);
    expect(result.thinned).toEqual([change(0, 0.02, 2)]);
  });
});

const RANGE = { bankMSB: 0, program: 39, keys: [{ key: 36, attenuationDelta: 10 }] };
const VARIATION_RANGE = { program: 39, bankLSB: 40, keys: [{ key: 36, attenuationDelta: 20 }] };

describe('variationFitCorrections', () => {
  test('fits the variations without the variation range corrections', () => {
    const existing = { ...NO_CORRECTIONS, ranges: [RANGE], variationRanges: [VARIATION_RANGE] };
    const variations = [{ program: 39, bankLSB: 40, attenuationDelta: 5, velocityAmountDelta: 0 }];
    expect(variationFitCorrections(existing, variations)).toEqual({
      ...existing,
      variations,
      variationRanges: [],
    });
  });
});

describe('checkCorrections', () => {
  test('leaves out the variation range corrections on both sides', () => {
    const corrections = {
      ...NO_CORRECTIONS,
      ranges: [RANGE],
      variationRanges: [VARIATION_RANGE],
    };
    expect(checkCorrections(corrections)).toEqual([
      { ...corrections, ranges: [], variationRanges: [] },
      { ...corrections, variationRanges: [] },
    ]);
  });
});
