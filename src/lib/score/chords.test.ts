import { describe, expect, test } from 'bun:test';
import type { ScoreBar } from './bars.ts';
import { chordOverhang, placeChords } from './chords.ts';
import { buildGeometry, tickToX } from './geometry.ts';
import type { ScoreModel } from './notation.ts';
import type { ScoreItem } from './rhythm.ts';

const GRID = 20;
const BAR = 1920;

function bar(index: number): ScoreBar {
  return {
    startTick: index * BAR,
    ticks: BAR,
    numerator: 4,
    denominator: 4,
    timeChanged: index === 0,
    keySharps: 0,
    keyChanged: false,
    sectionStart: false,
  };
}

const WHOLE: ScoreItem = { startGrid: 0, lenGrid: 96, keys: [60], tieFromPrev: false };

function scoreModel(barCount: number): ScoreModel {
  return {
    bars: Array.from({ length: barCount }, (_, i) => bar(i)),
    staves: [
      {
        channel: 0,
        kind: 'pitched',
        clef: 'treble',
        bars: Array.from({ length: barCount }, () => [WHOLE]),
        continuation: false,
        marks: [],
        labels: [],
      },
    ],
    gridTicks: GRID,
  };
}

const model = scoreModel(2);
const geometry = buildGeometry(model, () => 0);
const xAt = (tick: number) => tickToX(geometry, model.bars, tick);

describe('placeChords', () => {
  test('puts each chord at the x of its tick', () => {
    const placed = placeChords(model, geometry, [0, 960, BAR], [10, 10, 10], 4);
    expect(placed.map((p) => p.x)).toEqual([xAt(0), xAt(960), xAt(BAR)]);
    expect(placed.map((p) => p.bar)).toEqual([0, 0, 1]);
  });

  test('moves a chord right of the one before it when they would overlap', () => {
    const placed = placeChords(model, geometry, [0, 20, 40, BAR], [50, 50, 50, 50], 4);
    expect(xAt(40) - xAt(0)).toBeLessThan(50);
    expect(placed.slice(0, 3).map((p) => p.x)).toEqual([xAt(0), xAt(0) + 54, xAt(0) + 108]);
    expect(placed[3]!.x).toBe(xAt(BAR));
  });

  test('puts a chord pushed over a barline in the bar it lands in', () => {
    const placed = placeChords(model, geometry, [0, 960], [geometry.width[0]! + 10, 10], 4);
    expect(placed[1]!.bar).toBe(1);
  });

  test('keeps chords outside the score in the first and last bars', () => {
    const placed = placeChords(
      model,
      geometry,
      [-480, BAR, 99999],
      [10, geometry.total + 10, 10],
      4,
    );
    expect(placed.map((p) => p.bar)).toEqual([0, 1, 1]);
    expect(placed[2]!.x).toBeGreaterThan(geometry.total);
  });

  test('spaces chords in tick order and keeps the order they were given in', () => {
    const placed = placeChords(model, geometry, [BAR, 0, 20], [10, 50, 50], 4);
    expect(placed.map((p) => p.x)).toEqual([xAt(BAR), xAt(0), xAt(0) + 54]);
  });

  test('returns nothing for a score without bars', () => {
    const empty = scoreModel(0);
    expect(
      placeChords(
        empty,
        buildGeometry(empty, () => 0),
        [0],
        [10],
        4,
      ),
    ).toEqual([]);
  });
});

describe('chordOverhang', () => {
  const barEnd = (bi: number) => geometry.x[bi]! + geometry.width[bi]!;

  test('returns how far a chord reaches past the end of its bar', () => {
    const placed = [{ bar: 0, x: barEnd(0) - 10 }];
    expect(chordOverhang(placed, [40], geometry)).toBe(30);
  });

  test('leaves out the last bar, whose chords run into the room after the score', () => {
    const placed = [
      { bar: 0, x: barEnd(0) - 10 },
      { bar: 1, x: geometry.total + 500 },
    ];
    expect(chordOverhang(placed, [40, 40], geometry)).toBe(30);
  });
});
