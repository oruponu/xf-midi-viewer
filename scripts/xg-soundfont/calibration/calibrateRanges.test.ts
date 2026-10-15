import { describe, expect, test } from 'bun:test';
import { calibrateRanges, rangeFitCorrections } from './calibrateRanges.ts';
import type { RangeCalibrationInput } from './calibrateRanges.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import type { RangeCorrection } from './corrections.ts';
import { ATTENUATION_PER_DB } from './fit.ts';
import { voiceLevelKey } from './levels.ts';
import type { Level, LevelTable } from './levels.ts';
import type { VoiceId } from './testMidi.ts';

const NOTES = [36, 48];
const VELOCITIES = [40, 100];
const SAW: VoiceId = { bankMSB: 0, program: 81 };
const HARMONICA: VoiceId = { bankMSB: 0, program: 22 };
const SHIFT = 18;

const base = (v: VoiceId, note: number, velocity: number) =>
  -40 + v.program / 10 + note / 24 + 12 * Math.log2(velocity / 127);

function table(
  voices: readonly VoiceId[],
  f: (v: VoiceId, note: number, velocity: number) => Level,
): LevelTable {
  return {
    drums: [],
    voices: voices.map((v) => ({
      ...v,
      levels: Object.fromEntries(
        NOTES.flatMap((n) =>
          VELOCITIES.map((vel) => [voiceLevelKey(n, vel), f(v, n, vel)] as const),
        ),
      ),
    })),
  };
}

function synth(
  voices: readonly VoiceId[],
  options: { ignoreDeltas?: boolean; gain?: number } = {},
) {
  let calls = 0;
  const measure = (ranges: readonly RangeCorrection[]): LevelTable => {
    calls++;
    return table(voices, (v, n, vel) => {
      const keys = ranges.find((r) => r.bankMSB === v.bankMSB && r.program === v.program)?.keys;
      const delta = options.ignoreDeltas
        ? 0
        : (keys?.find((k) => k.key === n)?.attenuationDelta ?? 0);
      return base(v, n, vel) - ((options.gain ?? 1) * delta) / ATTENUATION_PER_DB;
    });
  };
  return { measure, calls: () => calls };
}

const reference = (
  voices: readonly VoiceId[],
  offset: (v: VoiceId, note: number, velocity: number) => number | null,
) =>
  table(voices, (v, n, vel) => {
    const o = offset(v, n, vel);
    return o === null ? null : base(v, n, vel) + SHIFT + o;
  });

const input = (
  voices: readonly VoiceId[],
  overrides: Partial<RangeCalibrationInput> & Pick<RangeCalibrationInput, 'reference' | 'measure'>,
): RangeCalibrationInput => ({
  voices,
  notes: NOTES,
  velocities: VELOCITIES,
  shiftDb: SHIFT,
  limit: () => ({ min: -1440, max: 1440 }),
  ...overrides,
});

describe('calibrateRanges', () => {
  test('fits each note of each voice to the reference', () => {
    const voices = [SAW, HARMONICA];
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, (_, n) => (n === 36 ? 2 : -1)),
        measure: synth(voices).measure,
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.largestResidualDb).toBeLessThanOrEqual(0.1);
    const keys = [
      { key: 36, attenuationDelta: -50 },
      { key: 48, attenuationDelta: 25 },
    ];
    expect(result.ranges).toEqual([
      { ...SAW, keys },
      { ...HARMONICA, keys },
    ]);
  });

  test('leaves out silent points and notes', () => {
    const voices = [SAW, HARMONICA];
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, (v, n, vel) => {
          if (v === HARMONICA && n === 48) return null;
          if (v === SAW && n === 48 && vel === 40) return null;
          return 1;
        }),
        measure: synth(voices).measure,
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.unmeasuredNotes).toBe(1);
    expect(result.ranges.find((r) => r.program === 22)?.keys.map((k) => k.key)).toEqual([36]);
    expect(result.points.count).toBe(NOTES.length * VELOCITIES.length * 2 - 2 - 1);
  });

  test('leaves a voice without measurable notes uncorrected and reports it', () => {
    const voices = [SAW, HARMONICA];
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, (v) => (v === HARMONICA ? null : 0)),
        measure: synth(voices).measure,
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.unmeasured).toEqual(['voice 0/22']);
    expect(result.ranges.map((r) => r.program)).toEqual([81]);
  });

  test('stops a note at its limits, reports it and still fits the others', () => {
    const voices = [SAW];
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, () => 2),
        measure: synth(voices).measure,
        limit: (_, note) => (note === 36 ? { min: -20, max: 1440 } : { min: -1440, max: 1440 }),
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.outOfRange).toEqual(['voice 0/81 note 36: needs -50 cB, allowed -20 to 1440']);
    expect(result.ranges[0].keys).toEqual([
      { key: 36, attenuationDelta: -20 },
      { key: 48, attenuationDelta: -50 },
    ]);
    expect(result.largestResidualDb).toBeGreaterThan(1);
  });

  test('takes a note back into the fit once it no longer needs to pass its limits', () => {
    const voices = [SAW];
    // Twice as strong as expected: the -30 cB limit overshoots the 2 dB target, so the next step is
    // inside the limits again and the fit has to go on with that note.
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, () => 2),
        measure: synth(voices, { gain: 2 }).measure,
        limit: () => ({ min: -30, max: 1440 }),
      }),
    );
    expect(result.outOfRange).toEqual([]);
    expect(result.passed).toBe(false);
  });

  test('fails before measuring when an interpolated note leaves the limits', () => {
    const voices = [SAW];
    const { measure, calls } = synth(voices);
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, () => 2),
        measure,
        limit: (_, note) => (note === 42 ? { min: -10, max: 1440 } : { min: -1440, max: 1440 }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.outOfRange).toEqual([
      'voice 0/81 note 42: interpolated -50 cB, allowed -10 to 1440',
    ]);
    expect(calls()).toBe(1);
  });

  test('accepts a residual of exactly the tolerance despite rounding in the arithmetic', () => {
    const voices = [SAW];
    const { measure, calls } = synth(voices, { ignoreDeltas: true });
    const result = calibrateRanges(
      input(voices, { reference: reference(voices, () => 0.1), measure, maxIterations: 3 }),
    );
    expect(result.passed).toBe(true);
    expect(calls()).toBe(1);
  });

  test('fails when the level cannot reach the target', () => {
    const voices = [SAW];
    const { measure, calls } = synth(voices, { ignoreDeltas: true });
    const result = calibrateRanges(
      input(voices, { reference: reference(voices, () => 2), measure, maxIterations: 3 }),
    );
    expect(result.passed).toBe(false);
    expect(calls()).toBe(1 + 3);
  });

  test('stops when a voice or a point is missing', () => {
    const voices = [SAW, HARMONICA];
    const { measure } = synth(voices);
    expect(() =>
      calibrateRanges(input(voices, { reference: reference([SAW], () => 0), measure })),
    ).toThrow('voice 0/22 is missing from the reference');
    const full = reference(voices, () => 0);
    const noPoint: LevelTable = {
      drums: [],
      voices: full.voices.map((v) => ({
        ...v,
        levels: Object.fromEntries(Object.entries(v.levels).filter(([k]) => k !== '48/100')),
      })),
    };
    expect(() => calibrateRanges(input(voices, { reference: noPoint, measure }))).toThrow(
      'voice 0/81: point 48/100 is missing from the reference',
    );
  });

  test('stops when a point can no longer be measured', () => {
    const voices = [SAW];
    const { measure } = synth(voices);
    let first = true;
    expect(() =>
      calibrateRanges(
        input(voices, {
          reference: reference(voices, () => 2),
          measure: (ranges) => {
            const t = measure(ranges);
            if (first) {
              first = false;
              return t;
            }
            return {
              ...t,
              voices: t.voices.map((v) => ({ ...v, levels: { ...v.levels, '36/100': null } })),
            };
          },
        }),
      ),
    ).toThrow('voice 0/81 point 36/100 can no longer be measured');
  });

  test('keeps fitting a point that ends just below the silent level', () => {
    const voices = [SAW];
    const { measure } = synth(voices);
    let first = true;
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, () => 2),
        measure: (ranges) => {
          const t = measure(ranges);
          if (first) {
            first = false;
            return t;
          }
          return {
            ...t,
            voices: t.voices.map((v) => ({ ...v, levels: { ...v.levels, '36/100': -81 } })),
          };
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.points.count).toBe(NOTES.length * VELOCITIES.length);
  });

  test('leaves out a point whose target is below the silent level', () => {
    const voices = [SAW];
    const result = calibrateRanges(
      input(voices, {
        reference: reference(voices, (_, n) => (n === 48 ? -60 : 1)),
        measure: synth(voices).measure,
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.unmeasuredNotes).toBe(1);
    expect(result.ranges[0].keys.map((k) => k.key)).toEqual([36]);
  });
});

describe('rangeFitCorrections', () => {
  test('fits the ranges without the variation range corrections', () => {
    const variationRange = { program: 39, bankLSB: 40, keys: [{ key: 36, attenuationDelta: 20 }] };
    const existing = { ...NO_CORRECTIONS, variationRanges: [variationRange] };
    const ranges = [{ bankMSB: 0, program: 39, keys: [{ key: 36, attenuationDelta: 10 }] }];
    expect(rangeFitCorrections(existing, ranges)).toEqual({
      ...existing,
      ranges,
      variationRanges: [],
    });
  });
});
