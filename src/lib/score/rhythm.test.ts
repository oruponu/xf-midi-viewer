import { describe, expect, test } from 'bun:test';
import { beamGroups, layoutNotes } from './rhythm.ts';
import type { ScoreItem, TimedNote } from './rhythm.ts';
import type { ScoreBar } from './bars.ts';

const GRID = 120;

function bar(startTick: number, numerator = 4, denominator = 4): ScoreBar {
  return {
    startTick,
    ticks: (480 * 4 * numerator) / denominator,
    numerator,
    denominator,
    timeChanged: false,
    keySharps: 0,
    keyChanged: false,
    sectionStart: false,
  };
}

const TWO_BARS = [bar(0), bar(1920)];

function note(startTick: number, endTick: number, pitch = 60): TimedNote {
  return { startTick, endTick, note: pitch };
}

type Row = [startGrid: number, lenGrid: number, keys: number[], tieFromPrev: boolean];

function rows(items: readonly ScoreItem[]): Row[] {
  return items.map((it) => [it.startGrid, it.lenGrid, it.keys, it.tieFromPrev]);
}

function firstBar(notes: TimedNote[], drums = false): Row[] {
  return rows(layoutNotes(notes, TWO_BARS, GRID, drums)[0]!);
}

describe('layoutNotes', () => {
  test('merges notes starting on the same grid into a chord', () => {
    expect(firstBar([note(0, 480, 64), note(0, 480, 60)])).toEqual([
      [0, 4, [60, 64], false],
      [4, 4, [], false],
      [8, 8, [], false],
    ]);
  });

  test('absorbs a one-grid gap into the note', () => {
    expect(firstBar([note(0, 120), note(240, 360)])[0]).toEqual([0, 2, [60], false]);
  });

  test('holds a one-grid note to the next beat', () => {
    expect(firstBar([note(0, 100)])[0]).toEqual([0, 4, [60], false]);
  });

  test('keeps an eighth rest after an eighth note', () => {
    expect(firstBar([note(0, 240), note(480, 720)]).slice(0, 3)).toEqual([
      [0, 2, [60], false],
      [2, 2, [], false],
      [4, 2, [60], false],
    ]);
  });

  test('splits a note at aligned lengths and ties the pieces', () => {
    expect(firstBar([note(0, 100, 72), note(120, 1920)]).slice(1)).toEqual([
      [1, 3, [60], false],
      [4, 8, [60], true],
      [12, 4, [60], true],
    ]);
  });

  test('keeps notes shorter than a quarter within the beat', () => {
    expect(firstBar([note(0, 120), note(120, 360), note(360, 480)]).slice(0, 3)).toEqual([
      [0, 1, [60], false],
      [1, 2, [60], false],
      [3, 1, [60], false],
    ]);
    expect(firstBar([note(360, 720)]).filter((r) => r[2].length > 0)).toEqual([
      [3, 1, [60], false],
      [4, 2, [60], true],
    ]);
  });

  test('places dotted notes on the boundary of their undotted value', () => {
    expect(firstBar([note(0, 720)])[0]).toEqual([0, 6, [60], false]);
    expect(firstBar([note(240, 960)]).filter((r) => r[2].length > 0)).toEqual([
      [2, 2, [60], false],
      [4, 4, [60], true],
    ]);
  });

  test('writes a half note across the middle of a 4/4 bar', () => {
    expect(firstBar([note(480, 1440)]).filter((r) => r[2].length > 0)).toEqual([
      [4, 8, [60], false],
    ]);
  });

  test('uses undotted rests that follow the beats', () => {
    expect(firstBar([note(0, 120)])).toEqual([
      [0, 4, [60], false],
      [4, 4, [], false],
      [8, 8, [], false],
    ]);
  });

  test('uses one whole rest for an empty bar', () => {
    expect(rows(layoutNotes([note(0, 480)], TWO_BARS, GRID, false)[1]!)).toEqual([
      [0, 16, [], false],
    ]);
  });

  test('ties a note across the bar line', () => {
    const [first, second] = layoutNotes([note(1440, 2400)], TWO_BARS, GRID, false);
    expect(rows(first!).at(-1)).toEqual([12, 4, [60], false]);
    expect(rows(second!)[0]).toEqual([0, 4, [60], true]);
  });

  test('keeps items on the grid in a 32nd-note time signature', () => {
    const items = layoutNotes([note(0, 100)], [bar(0, 4, 32)], GRID, false)[0]!;
    expect(rows(items)).toEqual([
      [0, 1, [60], false],
      [1, 1, [], false],
    ]);
  });

  test('never ties drum hits', () => {
    const [first, second] = layoutNotes([note(0, 1440, 38)], TWO_BARS, GRID, true);
    expect(rows(first!)).toEqual([
      [0, 4, [38], false],
      [4, 4, [], false],
      [8, 8, [], false],
    ]);
    expect(rows(second!)).toEqual([[0, 16, [], false]]);
  });

  test('spells compound meters in dotted-quarter beats', () => {
    const sixEight = [bar(0, 6, 8)];
    const twelveEight = [bar(0, 12, 8)];
    const layout = (notes: TimedNote[], bars: ScoreBar[]) =>
      rows(layoutNotes(notes, bars, GRID, false)[0]!);

    expect(layout([note(0, 720), note(720, 1440)], sixEight)).toEqual([
      [0, 6, [60], false],
      [6, 6, [60], false],
    ]);
    expect(layout([note(0, 720)], sixEight)).toEqual([
      [0, 6, [60], false],
      [6, 6, [], false],
    ]);
    expect(layout([note(240, 1200)], sixEight).filter((r) => r[2].length > 0)).toEqual([
      [2, 4, [60], false],
      [6, 4, [60], true],
    ]);
    expect(
      layout(
        [0, 720, 1440, 2160].map((t) => note(t, t + 720)),
        twelveEight,
      ),
    ).toEqual([
      [0, 6, [60], false],
      [6, 6, [60], false],
      [12, 6, [60], false],
      [18, 6, [60], false],
    ]);
    expect(layout([note(0, 1440, 64), note(1440, 2880)], twelveEight)).toEqual([
      [0, 12, [64], false],
      [12, 12, [60], false],
    ]);
  });
});

describe('beamGroups', () => {
  const eighths = (from: number, to: number) =>
    Array.from({ length: (to - from) / 2 }, (_, i): ScoreItem => ({
      startGrid: from + i * 2,
      lenGrid: 2,
      keys: [60],
      tieFromPrev: false,
    }));
  const quarterRest = (startGrid: number): ScoreItem => ({
    startGrid,
    lenGrid: 4,
    keys: [],
    tieFromPrev: false,
  });

  test('beams four plain eighths as one half-bar group in 4/4', () => {
    expect(beamGroups(bar(0), eighths(0, 16))).toEqual([[2, 4]]);
    expect(beamGroups(bar(0), [...eighths(0, 8), quarterRest(8), quarterRest(12)])).toEqual([
      [2, 4],
      [1, 4],
      [1, 4],
    ]);
    expect(beamGroups(bar(0), [quarterRest(0), quarterRest(4), ...eighths(8, 16)])).toEqual([
      [1, 4],
      [1, 4],
      [2, 4],
    ]);
    expect(
      beamGroups(bar(0), [...eighths(0, 6), quarterRest(6), quarterRest(10), ...eighths(14, 16)]),
    ).toEqual([[1, 4]]);
  });

  test('uses VexFlow defaults outside 4/4', () => {
    expect(beamGroups(bar(0, 3, 4), eighths(0, 12))).toBeNull();
  });
});
