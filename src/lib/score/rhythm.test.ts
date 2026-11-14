import { describe, expect, test } from 'bun:test';
import { beamGroups, layoutNotes } from './rhythm.ts';
import type { ScoreItem, TimedNote } from './rhythm.ts';
import type { ScoreBar } from './bars.ts';
import { NO_SWING } from './subdivision.ts';

const GRID = 20;

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

type TripletRow = [startGrid: number, lenGrid: number, keys: number[], triplet: number];

function tripletRows(items: readonly ScoreItem[]): TripletRow[] {
  return items.map((it) => [it.startGrid, it.lenGrid, it.keys, it.triplet ?? 0]);
}

function firstBar(notes: TimedNote[], drums = false): Row[] {
  return rows(layoutNotes(notes, TWO_BARS, GRID, drums, NO_SWING)[0]!);
}

describe('layoutNotes', () => {
  test('merges notes starting on the same grid into a chord', () => {
    expect(firstBar([note(0, 480, 64), note(0, 480, 60)])).toEqual([
      [0, 24, [60, 64], false],
      [24, 24, [], false],
      [48, 48, [], false],
    ]);
  });

  test('absorbs a sixteenth gap into the note', () => {
    expect(firstBar([note(0, 120), note(240, 360)])[0]).toEqual([0, 12, [60], false]);
  });

  test('holds a sixteenth note to the next beat', () => {
    expect(firstBar([note(0, 100)])[0]).toEqual([0, 24, [60], false]);
  });

  test('holds a sixteenth note to the beat the meter is spelled in', () => {
    const firstItem = (b: ScoreBar) =>
      rows(layoutNotes([note(0, 100)], [b], GRID, false, NO_SWING)[0]!)[0];
    expect(firstItem(bar(0, 2, 2))).toEqual([0, 24, [60], false]);
    expect(firstItem(bar(0, 6, 8))).toEqual([0, 36, [60], false]);
  });

  test('keeps an eighth rest after an eighth note', () => {
    expect(firstBar([note(0, 240), note(480, 720)]).slice(0, 3)).toEqual([
      [0, 12, [60], false],
      [12, 12, [], false],
      [24, 12, [60], false],
    ]);
  });

  test('splits a note at aligned lengths and ties the pieces', () => {
    expect(firstBar([note(0, 100, 72), note(120, 1920)]).slice(1)).toEqual([
      [6, 18, [60], false],
      [24, 48, [60], true],
      [72, 24, [60], true],
    ]);
  });

  test('keeps notes shorter than a quarter within the beat', () => {
    expect(firstBar([note(0, 120), note(120, 360), note(360, 480)]).slice(0, 3)).toEqual([
      [0, 6, [60], false],
      [6, 12, [60], false],
      [18, 6, [60], false],
    ]);
    expect(firstBar([note(360, 720)]).filter((r) => r[2].length > 0)).toEqual([
      [18, 6, [60], false],
      [24, 12, [60], true],
    ]);
  });

  test('places dotted notes on the boundary of their undotted value', () => {
    expect(firstBar([note(0, 720)])[0]).toEqual([0, 36, [60], false]);
    expect(firstBar([note(240, 960)]).filter((r) => r[2].length > 0)).toEqual([
      [12, 12, [60], false],
      [24, 24, [60], true],
    ]);
  });

  test('writes a half note across the middle of a 4/4 bar', () => {
    expect(firstBar([note(480, 1440)]).filter((r) => r[2].length > 0)).toEqual([
      [24, 48, [60], false],
    ]);
  });

  test('uses undotted rests that follow the beats', () => {
    expect(firstBar([note(0, 120)])).toEqual([
      [0, 24, [60], false],
      [24, 24, [], false],
      [48, 48, [], false],
    ]);
  });

  test('uses one whole rest for an empty bar', () => {
    expect(rows(layoutNotes([note(0, 480)], TWO_BARS, GRID, false, NO_SWING)[1]!)).toEqual([
      [0, 96, [], false],
    ]);
  });

  test('ties a note across the bar line', () => {
    const [first, second] = layoutNotes([note(1440, 2400)], TWO_BARS, GRID, false, NO_SWING);
    expect(rows(first!).at(-1)).toEqual([72, 24, [60], false]);
    expect(rows(second!)[0]).toEqual([0, 24, [60], true]);
  });

  test('keeps items on the grid in a 32nd-note time signature', () => {
    const items = layoutNotes([note(0, 100)], [bar(0, 4, 32)], GRID, false, NO_SWING)[0]!;
    expect(rows(items)).toEqual([[0, 12, [60], false]]);
  });

  test('never ties drum hits', () => {
    const [first, second] = layoutNotes([note(0, 1440, 38)], TWO_BARS, GRID, true, NO_SWING);
    expect(rows(first!)).toEqual([
      [0, 24, [38], false],
      [24, 24, [], false],
      [48, 48, [], false],
    ]);
    expect(rows(second!)).toEqual([[0, 96, [], false]]);
  });

  test('spells compound meters in dotted-quarter beats', () => {
    const sixEight = [bar(0, 6, 8)];
    const twelveEight = [bar(0, 12, 8)];
    const layout = (notes: TimedNote[], bars: ScoreBar[]) =>
      rows(layoutNotes(notes, bars, GRID, false, NO_SWING)[0]!);

    expect(layout([note(0, 720), note(720, 1440)], sixEight)).toEqual([
      [0, 36, [60], false],
      [36, 36, [60], false],
    ]);
    expect(layout([note(0, 720)], sixEight)).toEqual([
      [0, 36, [60], false],
      [36, 36, [], false],
    ]);
    expect(layout([note(240, 1200)], sixEight).filter((r) => r[2].length > 0)).toEqual([
      [12, 24, [60], false],
      [36, 24, [60], true],
    ]);
    expect(
      layout(
        [0, 720, 1440, 2160].map((t) => note(t, t + 720)),
        twelveEight,
      ),
    ).toEqual([
      [0, 36, [60], false],
      [36, 36, [60], false],
      [72, 36, [60], false],
      [108, 36, [60], false],
    ]);
    expect(layout([note(0, 1440, 64), note(1440, 2880)], twelveEight)).toEqual([
      [0, 72, [64], false],
      [72, 72, [60], false],
    ]);
  });

  test('writes eighth-note triplets over a quarter beat', () => {
    const items = layoutNotes(
      [note(0, 160), note(160, 320), note(320, 480)],
      TWO_BARS,
      GRID,
      false,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items)).toEqual([
      [0, 8, [60], 24],
      [8, 8, [60], 24],
      [16, 8, [60], 24],
      [24, 24, [], 0],
      [48, 48, [], 0],
    ]);
  });

  test('writes longer and shorter notes within a triplet', () => {
    const tripletBar = (notes: TimedNote[]) =>
      tripletRows(layoutNotes(notes, TWO_BARS, GRID, false, NO_SWING)[0]!).slice(0, -2);
    expect(tripletBar([note(0, 320), note(320, 480)])).toEqual([
      [0, 16, [60], 24],
      [16, 8, [60], 24],
    ]);
    expect(tripletBar([note(160, 320)])).toEqual([
      [0, 8, [], 24],
      [8, 8, [60], 24],
      [16, 8, [], 24],
    ]);
  });

  test('splits a beat of sixteenth-note triplets into two triplets', () => {
    const tripletBeat = (notes: TimedNote[], drums = false) =>
      tripletRows(layoutNotes(notes, TWO_BARS, GRID, drums, NO_SWING)[0]!).slice(0, -2);
    expect(tripletBeat([0, 80, 160, 240, 320, 400].map((t) => note(t, t + 80)))).toEqual(
      [0, 4, 8, 12, 16, 20].map((s) => [s, 4, [60], 12]),
    );
    expect(tripletBeat([note(0, 80), note(80, 160), note(160, 200)])).toEqual([
      [0, 4, [60], 12],
      [4, 4, [60], 12],
      [8, 4, [60], 12],
      [12, 12, [], 0],
    ]);
    expect(tripletBeat([note(0, 10, 38), note(80, 90, 38), note(160, 170, 38)], true)).toEqual([
      [0, 4, [38], 12],
      [4, 4, [38], 12],
      [8, 4, [38], 12],
      [12, 12, [], 0],
    ]);
  });

  test('keeps a beat of sixteenth-note triplets whole when a note crosses its middle', () => {
    const items = layoutNotes(
      [note(0, 80), note(80, 400), note(400, 480)],
      TWO_BARS,
      GRID,
      false,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items).slice(0, 3)).toEqual([
      [0, 4, [60], 24],
      [4, 16, [60], 24],
      [20, 4, [60], 24],
    ]);
  });

  test('ties a triplet note into a straight beat', () => {
    const items = layoutNotes([note(0, 160), note(160, 720)], TWO_BARS, GRID, false, NO_SWING)[0]!;
    expect(tripletRows(items).filter((r) => r[2].length > 0)).toEqual([
      [0, 8, [60], 24],
      [8, 16, [60], 24],
      [24, 12, [60], 0],
    ]);
    expect(items[2]!.tieFromPrev).toBe(true);
  });

  test('writes quarter-note triplets over two beats', () => {
    const items = layoutNotes(
      [note(0, 320), note(320, 640), note(640, 960)],
      TWO_BARS,
      GRID,
      false,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items)).toEqual([
      [0, 16, [60], 48],
      [16, 16, [60], 48],
      [32, 16, [60], 48],
      [48, 48, [], 0],
    ]);
  });

  test('keeps two triplet beats apart when no note crosses between them', () => {
    const items = layoutNotes(
      [note(0, 160), note(160, 480), note(480, 640), note(640, 960)],
      TWO_BARS,
      GRID,
      false,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items).slice(0, 4)).toEqual([
      [0, 8, [60], 24],
      [8, 16, [60], 24],
      [24, 8, [60], 24],
      [32, 16, [60], 24],
    ]);
  });

  test('writes thirty-second notes', () => {
    expect(firstBar([note(0, 60), note(60, 120), note(120, 240)]).slice(0, 3)).toEqual([
      [0, 3, [60], false],
      [3, 3, [60], false],
      [6, 18, [60], false],
    ]);
  });

  test('ends a drum hit in a triplet at the end of its beat', () => {
    const items = layoutNotes(
      [note(0, 10, 38), note(160, 170, 38), note(320, 330, 38)],
      TWO_BARS,
      GRID,
      true,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items)).toEqual([
      [0, 8, [38], 24],
      [8, 8, [38], 24],
      [16, 8, [38], 24],
      [24, 24, [], 0],
      [48, 48, [], 0],
    ]);
  });

  test('ends a drum hit on the grid of a triplet beat that follows', () => {
    const items = layoutNotes(
      [note(120, 130, 38), note(640, 650, 38)],
      TWO_BARS,
      GRID,
      true,
      NO_SWING,
    )[0]!;
    expect(tripletRows(items).slice(0, 4)).toEqual([
      [0, 6, [], 0],
      [6, 18, [38], 0],
      [24, 8, [], 24],
      [32, 16, [38], 24],
    ]);
  });

  test('writes swung eighths straight in a shuffle', () => {
    const swing = { eighths: true, sixteenths: false };
    const items = layoutNotes([note(0, 320), note(320, 480)], TWO_BARS, GRID, false, swing)[0]!;
    expect(tripletRows(items).slice(0, 2)).toEqual([
      [0, 12, [60], 0],
      [12, 12, [60], 0],
    ]);
  });
});

describe('beamGroups', () => {
  const eighths = (from: number, to: number) =>
    Array.from({ length: (to - from) / 12 }, (_, i): ScoreItem => ({
      startGrid: from + i * 12,
      lenGrid: 12,
      keys: [60],
      tieFromPrev: false,
    }));
  const quarterRest = (startGrid: number): ScoreItem => ({
    startGrid,
    lenGrid: 24,
    keys: [],
    tieFromPrev: false,
  });

  test('beams four plain eighths as one half-bar group in 4/4', () => {
    expect(beamGroups(bar(0), eighths(0, 96))).toEqual([[2, 4]]);
    expect(beamGroups(bar(0), [...eighths(0, 48), quarterRest(48), quarterRest(72)])).toEqual([
      [2, 4],
      [1, 4],
      [1, 4],
    ]);
    expect(beamGroups(bar(0), [quarterRest(0), quarterRest(24), ...eighths(48, 96)])).toEqual([
      [1, 4],
      [1, 4],
      [2, 4],
    ]);
    expect(
      beamGroups(bar(0), [...eighths(0, 36), quarterRest(36), quarterRest(60), ...eighths(84, 96)]),
    ).toEqual([[1, 4]]);
  });

  test('uses VexFlow defaults outside 4/4', () => {
    expect(beamGroups(bar(0, 3, 4), eighths(0, 72))).toBeNull();
  });
});
