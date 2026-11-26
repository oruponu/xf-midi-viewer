import { describe, expect, test } from 'bun:test';
import {
  barAtTick,
  barAtX,
  buildGeometry,
  labelOverhang,
  LAST_ITEM_ROOM,
  offsetInBar,
  staffOverhang,
  stemReach,
  tickToX,
  xToTick,
} from './geometry.ts';
import type { BarGeometry } from './geometry.ts';
import type { ScoreBar } from './bars.ts';
import type { ScoreModel, ScoreStaff, StaffKind } from './notation.ts';
import type { ScoreItem } from './rhythm.ts';

const GRID = 20;
const SIXTEENTH_TICKS = 6 * GRID;
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

const item = (startGrid: number, lenGrid: number, rest = false): ScoreItem => ({
  startGrid,
  lenGrid,
  keys: rest ? [] : [60],
  tieFromPrev: false,
});

function scoreModel(barItems: ScoreItem[][]): ScoreModel {
  return {
    bars: barItems.map((_, i) => bar(i)),
    staves: [
      {
        channel: 0,
        kind: 'pitched',
        clef: 'treble',
        bars: barItems,
        continuation: false,
        marks: [],
        labels: [],
      },
    ],
    gridTicks: GRID,
  };
}

// Bar 0 ends with a sixteenth and is followed by a 40-wide signature; bar 1 is a whole rest.
const MODEL = scoreModel([
  [item(0, 24), item(24, 24), item(48, 36), item(84, 6), item(90, 6)],
  [item(0, 96, true)],
  [item(0, 48), item(48, 48)],
]);
const PREFIX = [50, 40, 0];
const geometry = buildGeometry(MODEL, (bi) => PREFIX[bi]!);

function slopeAt(g: BarGeometry, bars: readonly ScoreBar[], tick: number): number {
  const bi = bars.findLastIndex((b) => b.startTick <= tick);
  return tick - bars[bi]!.startTick < g.tailStart[bi]! ? g.pxPerTick : g.tailPxPerTick[bi]!;
}

describe('labelOverhang', () => {
  const barEnd = (bi: number) => geometry.x[bi]! + geometry.width[bi]!;

  test('returns how far the widest label reaches past the end of its bar', () => {
    const placed = [
      { bar: 0, x: geometry.x[0]! },
      { bar: 0, x: barEnd(0) - 30 },
      { bar: 1, x: barEnd(1) - 30 },
    ];
    expect(labelOverhang(placed, [10, 80, 60], geometry)).toBe(50);
  });

  test('is zero when every label ends inside its bar', () => {
    const placed = [
      { bar: 0, x: geometry.x[0]! },
      { bar: 1, x: geometry.x[1]! },
    ];
    expect(labelOverhang(placed, [1, 1], geometry)).toBe(0);
    expect(labelOverhang([], [], geometry)).toBe(0);
  });
});

describe('buildGeometry', () => {
  test('uses one rate across a bar with no signature after it', () => {
    for (const into of [0, 480, 1000, BAR]) {
      expect(offsetInBar(geometry, 1, into)).toBeCloseTo(geometry.pxPerTick * into, 9);
    }
  });

  test("takes the next bar's prefix from the last segment only", () => {
    expect(geometry.tailStart[0]).toBe(15 * SIXTEENTH_TICKS);
    expect(offsetInBar(geometry, 0, 15 * SIXTEENTH_TICKS)).toBeCloseTo(
      geometry.pxPerTick * 15 * SIXTEENTH_TICKS,
      9,
    );
    expect(offsetInBar(geometry, 0, BAR)).toBeCloseTo(geometry.pxPerTick * BAR + 40, 9);
  });

  test('is increasing over the whole song', () => {
    let prev = -Infinity;
    for (let tick = 0; tick <= 3 * BAR; tick += 10) {
      const x = tickToX(geometry, MODEL.bars, tick);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  test('is continuous at segment and bar boundaries', () => {
    const boundaries = [15 * SIXTEENTH_TICKS, BAR, 2 * BAR, 2 * BAR + 8 * SIXTEENTH_TICKS];
    for (const b of boundaries) {
      const at = tickToX(geometry, MODEL.bars, b);
      const left = at - tickToX(geometry, MODEL.bars, b - 1);
      const right = tickToX(geometry, MODEL.bars, b + 1) - at;
      expect(left).toBeCloseTo(slopeAt(geometry, MODEL.bars, b - 1), 9);
      expect(right).toBeCloseTo(slopeAt(geometry, MODEL.bars, b), 9);
    }
  });

  test('gives the last sixteenth room before the barline', () => {
    expect(geometry.pxPerTick * SIXTEENTH_TICKS).toBeGreaterThanOrEqual(LAST_ITEM_ROOM);
    const eighthLast = buildGeometry(
      scoreModel([
        [item(0, 6), item(6, 6), item(12, 12), item(24, 24), item(48, 36), item(84, 12)],
      ]),
      () => 0,
    );
    expect(eighthLast.pxPerTick * SIXTEENTH_TICKS).toBe(32);
  });

  test('widens sixteenths for thirty-seconds and narrows them for eighth-note triplets', () => {
    const sixteenthWidth = (items: ScoreItem[]) =>
      buildGeometry(scoreModel([items, [item(0, 96)]]), () => 0).pxPerTick * SIXTEENTH_TICKS;
    expect(sixteenthWidth([item(0, 3), item(3, 3), item(6, 18), item(24, 72)])).toBeCloseTo(40, 9);
    expect(sixteenthWidth([item(0, 8), item(8, 8), item(16, 8), item(24, 72)])).toBeCloseTo(24, 9);
  });

  test('gives a last item shorter than a sixteenth its room in the last segment', () => {
    const g = buildGeometry(
      scoreModel([
        [item(0, 48), item(48, 36), item(84, 6), item(90, 3), item(93, 3)],
        [item(0, 96)],
      ]),
      () => 0,
    );
    const room = LAST_ITEM_ROOM - 3 * GRID * g.pxPerTick;
    expect(room).toBeGreaterThan(0);
    expect(g.tailStart[0]).toBe(93 * GRID);
    expect(offsetInBar(g, 0, BAR)).toBeCloseTo(g.pxPerTick * BAR + room, 9);
    expect(g.width[0]).toBeCloseTo(BAR * g.pxPerTick + room, 9);
  });

  test('adds room before the final barline', () => {
    expect(geometry.width[2]).toBeCloseTo(PREFIX[2]! + BAR * geometry.pxPerTick + 10, 9);
  });
});

describe('barAtX', () => {
  test('finds the bar whose cell holds x, signatures included', () => {
    expect(barAtX(geometry, 0)).toBe(0);
    expect(barAtX(geometry, geometry.x[1]! - 0.01)).toBe(0);
    expect(barAtX(geometry, geometry.x[1]!)).toBe(1);
    expect(barAtX(geometry, geometry.x[1]! + PREFIX[1]! / 2)).toBe(1);
    expect(barAtX(geometry, geometry.x[2]! + 1)).toBe(2);
  });

  test('clamps x outside the score to the first and last bars', () => {
    expect(barAtX(geometry, -100)).toBe(0);
    expect(barAtX(geometry, geometry.total + 100)).toBe(2);
  });
});

describe('xToTick', () => {
  test('inverts tickToX across segments and bars', () => {
    for (let tick = 0; tick <= 3 * BAR; tick += 30) {
      expect(xToTick(geometry, MODEL.bars, tickToX(geometry, MODEL.bars, tick))).toBeCloseTo(
        tick,
        6,
      );
    }
  });

  test('clamps x outside the notes to the start and end of the song', () => {
    expect(xToTick(geometry, MODEL.bars, 0)).toBe(0);
    expect(xToTick(geometry, MODEL.bars, geometry.total + 100)).toBe(3 * BAR);
  });
});

describe('staffOverhang', () => {
  const staff = (
    clef: 'treble' | 'bass',
    keys: number[],
    kind: StaffKind = 'pitched',
  ): ScoreStaff => ({
    channel: 0,
    kind,
    clef,
    bars: [keys.map((k, i) => ({ startGrid: i * 4, lenGrid: 4, keys: [k], tieFromPrev: false }))],
    continuation: false,
    marks: [],
    labels: [],
  });

  test('measures how far noteheads reach past the outer staff lines', () => {
    expect(staffOverhang(staff('treble', [64, 77]))).toEqual({ above: 5, below: 5 });
    expect(staffOverhang(staff('treble', [107])).above).toBe(90);
    expect(staffOverhang(staff('bass', [0])).below).toBe(130);
  });

  test('rounds accidentals outwards', () => {
    expect(staffOverhang(staff('treble', [78])).above).toBe(10);
    expect(staffOverhang(staff('bass', [42])).below).toBe(10);
  });

  test('ignores drum staves', () => {
    expect(staffOverhang(staff('treble', [36], 'drumSet'))).toEqual({ above: 0, below: 0 });
  });
});

describe('barAtTick', () => {
  const bars = [bar(0), bar(1), bar(2)];

  test('returns the bar that contains the tick', () => {
    expect(barAtTick(bars, 0)).toBe(0);
    expect(barAtTick(bars, BAR - 1)).toBe(0);
    expect(barAtTick(bars, BAR)).toBe(1);
  });

  test('clamps ticks outside the song', () => {
    expect(barAtTick(bars, -5)).toBe(0);
    expect(barAtTick(bars, Infinity)).toBe(2);
  });

  test('returns -1 without bars', () => {
    expect(barAtTick([], 0)).toBe(-1);
  });
});

describe('stemReach', () => {
  test('measures how far a stem pointing down reaches below the bottom line', () => {
    expect(stemReach('treble', [71], false)).toBe(15);
    expect(stemReach('bass', [50], false)).toBe(15);
  });

  test('measures from the lowest note of a chord', () => {
    expect(stemReach('treble', [64, 79], false)).toBe(35);
  });

  test('adds room for a beam', () => {
    expect(stemReach('treble', [71], true)).toBe(23);
    expect(stemReach('treble', [64], true)).toBe(43);
  });

  test('is zero when the stem ends above the bottom line', () => {
    expect(stemReach('treble', [96], false)).toBe(0);
  });

  test('is zero without notes and on percussion staves', () => {
    expect(stemReach('treble', [], false)).toBe(0);
    expect(stemReach('percussion', [38], false)).toBe(0);
  });
});
