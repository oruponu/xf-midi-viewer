import { describe, expect, test } from 'bun:test';
import type { SmfTiming } from '../smf/timing.ts';
import { buildScoreRows, countScoreBars, sameScoreRows } from './scoreRows.ts';
import type { BarFit } from './scoreRows.ts';

const rows = (barsPerRow: number, ...specs: [number, number][]) =>
  specs.map(([startBar, barCount]) => ({ startBar, barCount, barsPerRow }));

const row = (startBar: number, barCount: number, barsPerRow: number) => ({
  startBar,
  barCount,
  barsPerRow,
});

const fitsUpTo =
  (maxBarsPerRow: Record<number, number>): BarFit =>
  (bar, barsPerRow) =>
    barsPerRow <= (maxBarsPerRow[bar] ?? Infinity);

describe('buildScoreRows', () => {
  test('returns no rows for an empty score', () => {
    expect(buildScoreRows(0, 4, [])).toEqual([]);
  });

  test('splits the score into fixed rows without section starts', () => {
    expect(buildScoreRows(10, 4, [])).toEqual(rows(4, [1, 4], [5, 4], [9, 2]));
  });

  test('starts a new row at each section start', () => {
    expect(buildScoreRows(13, 4, [2, 6])).toEqual(rows(4, [1, 1], [2, 4], [6, 4], [10, 4]));
  });

  test('leaves a short row before the next section', () => {
    expect(buildScoreRows(22, 4, [10, 19])).toEqual(
      rows(4, [1, 4], [5, 4], [9, 1], [10, 4], [14, 4], [18, 1], [19, 4]),
    );
  });

  test('counts rows of two bars on narrow screens', () => {
    expect(buildScoreRows(8, 2, [3, 6])).toEqual(rows(2, [1, 2], [3, 2], [5, 1], [6, 2], [8, 1]));
  });

  test('ignores duplicate and unsorted section starts', () => {
    expect(buildScoreRows(9, 4, [5, 2, 5])).toEqual(rows(4, [1, 1], [2, 3], [5, 4], [9, 1]));
  });

  test('ignores section starts at bar 1 or outside the score', () => {
    expect(buildScoreRows(6, 4, [1, 0, 7, 12])).toEqual(rows(4, [1, 4], [5, 2]));
  });

  test('keeps the fixed rows when every bar fits', () => {
    expect(buildScoreRows(8, 4, [], () => true)).toEqual(rows(4, [1, 4], [5, 4]));
  });

  test('halves a row with a bar that does not fit', () => {
    expect(buildScoreRows(8, 4, [], fitsUpTo({ 2: 2 }))).toEqual([
      row(1, 2, 2),
      row(3, 2, 2),
      row(5, 4, 4),
    ]);
  });

  test('halves only the half that still does not fit', () => {
    expect(buildScoreRows(4, 4, [], fitsUpTo({ 1: 1 }))).toEqual([
      row(1, 1, 1),
      row(2, 1, 1),
      row(3, 2, 2),
    ]);
  });

  test('splits a three-bar row into two bars and one bar', () => {
    expect(buildScoreRows(3, 4, [], fitsUpTo({ 3: 2 }))).toEqual([row(1, 2, 2), row(3, 1, 2)]);
  });

  test('widens a single-bar row instead of splitting it', () => {
    expect(buildScoreRows(5, 4, [], fitsUpTo({ 5: 1 }))).toEqual([row(1, 4, 4), row(5, 1, 1)]);
  });

  test('gives a bar that fits nowhere a full row', () => {
    expect(buildScoreRows(4, 4, [], fitsUpTo({ 2: 0 }))).toEqual([
      row(1, 1, 1),
      row(2, 1, 1),
      row(3, 2, 2),
    ]);
  });

  test('splits rows within each section', () => {
    expect(buildScoreRows(8, 4, [5], fitsUpTo({ 6: 2 }))).toEqual([
      row(1, 4, 4),
      row(5, 2, 2),
      row(7, 2, 2),
    ]);
  });

  test('halves two-bar rows on narrow screens', () => {
    expect(buildScoreRows(4, 2, [], fitsUpTo({ 3: 1 }))).toEqual([
      row(1, 2, 2),
      row(3, 1, 1),
      row(4, 1, 1),
    ]);
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

describe('sameScoreRows', () => {
  test('treats rows built again from the same layout as the same', () => {
    expect(sameScoreRows(rows(4, [1, 4], [5, 2]), rows(4, [1, 4], [5, 2]))).toBe(true);
  });

  test('tells apart a different number of rows', () => {
    expect(sameScoreRows(rows(4, [1, 4]), rows(4, [1, 4], [5, 2]))).toBe(false);
  });

  test('tells apart a row with another bar count', () => {
    expect(sameScoreRows(rows(4, [1, 4], [5, 2]), rows(4, [1, 4], [5, 1]))).toBe(false);
  });

  test('tells apart a row with another bars-per-row', () => {
    expect(sameScoreRows([row(1, 2, 4)], [row(1, 2, 2)])).toBe(false);
  });
});

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
