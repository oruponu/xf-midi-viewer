import { describe, expect, test } from 'bun:test';
import { staffOverhang } from './geometry.ts';
import { buildStaffRows, rowRange } from './rows.ts';
import type { LyricBand } from './rows.ts';
import type { ScoreStaff } from './notation.ts';
import type { ScoreItem } from './rhythm.ts';

const GAP = 112;

const note = (key: number): ScoreItem => ({
  startGrid: 0,
  lenGrid: 96,
  keys: [key],
  tieFromPrev: false,
});

function staff(bars: ScoreItem[][] = [[note(67)]]): ScoreStaff {
  return {
    channel: 0,
    kind: 'pitched',
    clef: 'treble',
    bars,
    continuation: false,
    marks: [],
    labels: [],
  };
}

const band = (...staves: number[]): LyricBand => ({
  stems: new Map(staves.map((si) => [si, 0])),
  height: 46,
  staffBottom: 110,
  margin: 10,
});

describe('buildStaffRows', () => {
  test('spaces the staves evenly without a lyric band', () => {
    expect(buildStaffRows([staff(), staff(), staff()], GAP, null)).toEqual({
      tops: [0, 112, 224],
      lyricTops: [null, null, null],
      height: 336,
    });
  });

  test('opens a band below the lyric staff only', () => {
    expect(buildStaffRows([staff(), staff(), staff()], GAP, band(1))).toEqual({
      tops: [0, 112, 278],
      lyricTops: [null, 232, null],
      height: 390,
    });
  });

  test('moves the band below notes that hang under the staff', () => {
    const low = staff([[note(67)], [note(67)], [note(48)]]);
    const below = staffOverhang(low).below;
    expect(below).toBeGreaterThan(0);
    const rows = buildStaffRows([staff(), low, staff()], GAP, band(1));
    expect(rows.lyricTops[1]).toBe(112 + 110 + below + 10);
    expect(rows.tops[2]).toBe(rows.lyricTops[1]! + 46);
  });

  test('ends with the band when the lyric staff is the last', () => {
    const rows = buildStaffRows([staff(), staff(), staff()], GAP, band(2));
    expect(rows.tops).toEqual([0, 112, 224]);
    expect(rows.height).toBe(rows.lyricTops[2]! + 46);
  });

  test('opens a band below each lyric staff', () => {
    expect(buildStaffRows([staff(), staff(), staff()], GAP, band(0, 1))).toEqual({
      tops: [0, 166, 332],
      lyricTops: [120, 286, null],
      height: 444,
    });
  });
});

describe('rowRange', () => {
  const rows = buildStaffRows([staff(), staff(), staff()], GAP, band(1));

  test('returns the staves overlapping the range', () => {
    expect(rowRange(rows, 120, 200, 0)).toEqual([1, 1]);
    expect(rowRange(rows, 120, 200, 1)).toEqual([0, 2]);
  });

  test('counts the lyric band as part of the staff above it', () => {
    expect(rowRange(rows, 240, 260, 0)).toEqual([1, 1]);
  });

  test('clamps to the staves', () => {
    expect(rowRange(rows, -500, 5000, 2)).toEqual([0, 2]);
  });

  test('returns an empty range without staves', () => {
    expect(rowRange(buildStaffRows([], GAP, null), 0, 100, 1)).toEqual([0, -1]);
  });
});

describe('buildStaffRows with stems', () => {
  const stems = (reach: number): LyricBand => ({ ...band(), stems: new Map([[0, reach]]) });

  test('moves the band below stems that point down', () => {
    const rows = buildStaffRows([staff(), staff()], GAP, stems(23));
    expect(rows.lyricTops[0]).toBe(110 + 23 + 10);
  });

  test('keeps the band below notes that reach lower than the stems', () => {
    const low = staff([[note(48)]]);
    const below = staffOverhang(low).below;
    expect(below).toBeGreaterThan(23);
    const rows = buildStaffRows([low, staff()], GAP, stems(23));
    expect(rows.lyricTops[0]).toBe(110 + below + 10);
  });
});
