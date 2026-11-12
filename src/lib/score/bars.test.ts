import { describe, expect, test } from 'bun:test';
import { assignKeys, buildBars, markSections } from './bars.ts';
import type { SmfTiming } from '../smf/timing.ts';

const PPQ = 480;

function timing(
  times: [tick: number, numerator: number, denominator: number][] = [],
  keys: [tick: number, sharps: number][] = [],
): SmfTiming {
  return {
    ppq: PPQ,
    timeSignatures: times.map(([tick, numerator, denominator]) => ({
      tick,
      signature: { numerator, denominator, clocksPerClick: 24, thirtySecondNotesPerQuarter: 8 },
    })),
    keySignatures: keys.map(([tick, sharps]) => ({ tick, signature: { sharps, mode: 'major' } })),
  };
}

describe('buildBars', () => {
  test('builds 4/4 bars when the song has no time signature', () => {
    const bars = buildBars(timing(), 4000, PPQ);
    expect(bars.map((b) => [b.startTick, b.ticks, b.numerator, b.denominator])).toEqual([
      [0, 1920, 4, 4],
      [1920, 1920, 4, 4],
      [3840, 1920, 4, 4],
    ]);
    expect(bars.map((b) => b.timeChanged)).toEqual([true, false, false]);
  });

  test('applies a time signature change from the next bar line', () => {
    const bars = buildBars(
      timing([
        [0, 4, 4],
        [2000, 3, 4],
      ]),
      6000,
      PPQ,
    );
    expect(bars.map((b) => [b.startTick, b.numerator])).toEqual([
      [0, 4],
      [1920, 4],
      [3840, 3],
      [5280, 3],
    ]);
    expect(bars.map((b) => b.timeChanged)).toEqual([true, false, true, false]);
  });

  test('rounds bars of a 32nd-note denominator to the grid', () => {
    const bars = buildBars(timing([[0, 3, 32]]), 400, PPQ);
    expect(bars[0]!.ticks).toBe(240);
  });

  test('caps the number of bars at 2000', () => {
    expect(buildBars(timing(), 1920 * 3000, PPQ)).toHaveLength(2000);
  });
});

describe('assignKeys', () => {
  test('applies a key change in the first half of a bar to that bar', () => {
    const t = timing(
      [],
      [
        [0, 0],
        [2400, 2],
      ],
    );
    const bars = buildBars(t, 1920 * 3, PPQ);
    assignKeys(bars, t, []);
    expect(bars.map((b) => [b.keySharps, b.keyChanged])).toEqual([
      [0, false],
      [2, true],
      [2, false],
    ]);
  });

  test('applies a key change in the second half of a bar to the next bar', () => {
    const t = timing(
      [],
      [
        [0, 0],
        [2900, 2],
      ],
    );
    const bars = buildBars(t, 1920 * 3, PPQ);
    assignKeys(bars, t, []);
    expect(bars.map((b) => [b.keySharps, b.keyChanged])).toEqual([
      [0, false],
      [0, false],
      [2, true],
    ]);
  });

  test('transposes key signatures by the key shift', () => {
    const withKey = timing([], [[0, 0]]);
    const bars = buildBars(withKey, 1920, PPQ);
    assignKeys(bars, withKey, [{ tick: 0, semitones: 2 }]);
    expect(bars[0]!.keySharps).toBe(2);

    const withoutKey = timing();
    const plain = buildBars(withoutKey, 1920, PPQ);
    assignKeys(plain, withoutKey, [{ tick: 0, semitones: 2 }]);
    expect(plain[0]!.keySharps).toBe(2);
  });
});

describe('markSections', () => {
  test('marks the bar a rehearsal mark falls in as a section start', () => {
    const bars = buildBars(timing(), 1920 * 3, PPQ);
    markSections(bars, [0, 4000]);
    expect(bars.map((b) => b.sectionStart)).toEqual([false, false, true]);
  });
});
