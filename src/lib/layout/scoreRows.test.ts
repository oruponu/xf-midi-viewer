import { describe, expect, test } from 'bun:test';
import type { SmfTiming } from '../smf/timing.ts';
import { buildScoreRows, countScoreBars } from './scoreRows.ts';

const rows = (...specs: [number, number][]) =>
  specs.map(([startBar, barCount]) => ({ startBar, barCount }));

describe('buildScoreRows', () => {
  test('returns no rows for an empty score', () => {
    expect(buildScoreRows(0, 4, [])).toEqual([]);
  });

  test('splits the score into fixed rows without section starts', () => {
    expect(buildScoreRows(10, 4, [])).toEqual(rows([1, 4], [5, 4], [9, 2]));
  });

  test('starts a new row at each section start', () => {
    expect(buildScoreRows(13, 4, [2, 6])).toEqual(rows([1, 1], [2, 4], [6, 4], [10, 4]));
  });

  test('leaves a short row before the next section', () => {
    expect(buildScoreRows(22, 4, [10, 19])).toEqual(
      rows([1, 4], [5, 4], [9, 1], [10, 4], [14, 4], [18, 1], [19, 4]),
    );
  });

  test('counts rows of two bars on narrow screens', () => {
    expect(buildScoreRows(8, 2, [3, 6])).toEqual(rows([1, 2], [3, 2], [5, 1], [6, 2], [8, 1]));
  });

  test('ignores duplicate and unsorted section starts', () => {
    expect(buildScoreRows(9, 4, [5, 2, 5])).toEqual(rows([1, 1], [2, 3], [5, 4], [9, 1]));
  });

  test('ignores section starts at bar 1 or outside the score', () => {
    expect(buildScoreRows(6, 4, [1, 0, 7, 12])).toEqual(rows([1, 4], [5, 2]));
  });
});

const timing: SmfTiming = {
  ppq: 480,
  timeSignatures: [
    {
      tick: 0,
      signature: {
        numerator: 4,
        denominator: 4,
        clocksPerClick: 24,
        thirtySecondNotesPerQuarter: 8,
      },
    },
  ],
  keySignatures: [],
};
const BAR = 1920;

describe('countScoreBars', () => {
  test('returns 0 without chords, rehearsal marks or lyrics', () => {
    expect(countScoreBars([], BAR * 3, timing)).toBe(0);
  });

  test('ends at the bar of the last mark when the song ends earlier', () => {
    expect(countScoreBars([0, BAR * 4], BAR, timing)).toBe(5);
  });

  test('extends to the bar containing the end of the song', () => {
    expect(countScoreBars([0, BAR * 4], BAR * 6 + 240, timing)).toBe(7);
  });

  test('does not add a bar for a song ending on a bar line', () => {
    expect(countScoreBars([0], BAR * 2, timing)).toBe(2);
  });
});
