import { describe, expect, test } from 'bun:test';
import type { RangeKey } from './corrections.ts';
import { ATTENUATION_PER_DB } from './fit.ts';
import { voiceLevelKey } from './levels.ts';
import type { LevelTable } from './levels.ts';
import { fitRanges } from './rangeFit.ts';
import type { RangeFit, RangeFitInput } from './rangeFit.ts';
import { steppedRangeOffsets } from './ranges.ts';
import type { VoiceId } from './testMidi.ts';

const NOTES = [36, 48];
const VELOCITIES = [40, 100];
const VOICE: VoiceId = { bankMSB: 0, bankLSB: 40, program: 39 };
const level = (note: number, velocity: number) => -40 + note / 24 + 12 * Math.log2(velocity / 127);

const table = (f: (note: number, velocity: number) => number): LevelTable => ({
  drums: [],
  voices: [
    {
      ...VOICE,
      levels: Object.fromEntries(
        NOTES.flatMap((n) => VELOCITIES.map((v) => [voiceLevelKey(n, v), f(n, v)] as const)),
      ),
    },
  ],
});

function measure(fits: readonly RangeFit[]): LevelTable {
  const keys = fits.find((f) => f.voice === VOICE)?.keys ?? [];
  return table(
    (n, v) =>
      level(n, v) - (keys.find((k) => k.key === n)?.attenuationDelta ?? 0) / ATTENUATION_PER_DB,
  );
}

const input = (offsetDb: number, overrides: Partial<RangeFitInput> = {}): RangeFitInput => ({
  voices: [VOICE],
  label: () => 'ModulrBa',
  notes: NOTES,
  velocities: VELOCITIES,
  reference: table((n, v) => level(n, v) + offsetDb),
  shiftDb: 0,
  limit: () => ({ min: -1440, max: 1440 }),
  offsets: (keys: readonly RangeKey[], where: string) => steppedRangeOffsets(keys, where, 10),
  step: 10,
  toleranceDb: 0.2,
  measure,
  ...overrides,
});

describe('fitRanges', () => {
  test('keeps each delta a multiple of the step and stops within the tolerance', () => {
    // 1.3 dB is 32.5 in attenuation, which the step of 10 leaves at 30 (1.2 dB).
    const result = fitRanges(input(1.3));
    expect(result.passed).toBe(true);
    expect(result.fits[0].keys).toEqual([
      { key: 36, attenuationDelta: -30 },
      { key: 48, attenuationDelta: -30 },
    ]);
    expect(result.largestResidualDb).toBeCloseTo(0.1, 5);
  });

  test('holds a delta at the nearest multiple of the step inside the limits', () => {
    const result = fitRanges(input(2, { limit: () => ({ min: -12, max: 1440 }) }));
    expect(result.fits[0].keys.map((k) => k.attenuationDelta)).toEqual([-10, -10]);
    expect(result.outOfRange).toContain('ModulrBa note 36: needs -50 cB, allowed -10 to 1440');
    expect(result.passed).toBe(true);
  });
});
