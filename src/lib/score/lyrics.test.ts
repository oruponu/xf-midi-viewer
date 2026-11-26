import { describe, expect, test } from 'bun:test';
import { buildGeometry, tickToX } from './geometry.ts';
import { assignLyrics, lyricStaffIndexes, placeLyrics, visibleSyllables } from './lyrics.ts';
import type { ScoreBar } from './bars.ts';
import type { ScoreModel, ScoreStaff, StaffKind } from './notation.ts';
import type { ScoreItem } from './rhythm.ts';
import type { LyricRun, LyricSyllable } from '../xf/lyrics.ts';

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

const item = (startGrid: number, lenGrid: number, extra: Partial<ScoreItem> = {}): ScoreItem => ({
  startGrid,
  lenGrid,
  keys: [60],
  tieFromPrev: false,
  ...extra,
});

function staff(
  channel: number,
  bars: ScoreItem[][] = [],
  kind: StaffKind = 'pitched',
  continuation = false,
): ScoreStaff {
  return {
    channel,
    kind,
    clef: kind === 'pitched' ? 'treble' : 'percussion',
    bars,
    continuation,
    marks: [],
    labels: [],
  };
}

function scoreModel(staves: ScoreStaff[], barCount: number): ScoreModel {
  return { bars: Array.from({ length: barCount }, (_, i) => bar(i)), staves, gridTicks: GRID };
}

const syllable = (tick: number, ...runs: (string | LyricRun)[]): LyricSyllable => ({
  tick,
  endTick: null,
  runs: runs.map((r) => (typeof r === 'string' ? { kind: 'text', text: r } : r)),
  vocalPart: null,
});

const QUARTERS = [item(0, 24), item(24, 24), item(48, 24), item(72, 24)];

function place(
  model: ScoreModel,
  syllables: LyricSyllable[],
  widths = syllables.map(() => 1),
  gap = 0,
  staffIndex = 0,
) {
  const geometry = buildGeometry(model, () => 0);
  return { geometry, placed: placeLyrics(model, geometry, staffIndex, syllables, widths, gap) };
}

describe('lyricStaffIndexes', () => {
  test('returns the pitched staff of the melody channel', () => {
    expect(lyricStaffIndexes([staff(0), staff(3)], [4])).toEqual([1]);
  });

  test('returns a staff for every melody channel, from the top', () => {
    expect(lyricStaffIndexes([staff(0), staff(3), staff(5)], [6, 4])).toEqual([1, 2]);
  });

  test('returns the lower staff of a grand staff', () => {
    expect(lyricStaffIndexes([staff(3), staff(3, [], 'pitched', true), staff(5)], [4, 6])).toEqual([
      1, 2,
    ]);
  });

  test('skips drum staves of the melody channel', () => {
    expect(lyricStaffIndexes([staff(3), staff(3, [], 'drumSet')], [4])).toEqual([0]);
    expect(lyricStaffIndexes([staff(3, [], 'drumSet')], [4])).toEqual([]);
  });

  test('returns nothing without melody channels', () => {
    expect(lyricStaffIndexes([staff(0), staff(3)], [])).toEqual([]);
  });
});

describe('assignLyrics', () => {
  const upper = [item(0, 24), item(24, 24), item(48, 48, { keys: [] })];
  const lower = [item(0, 24, { keys: [] }), item(24, 24), item(48, 24), item(72, 24)];
  const model = scoreModel([staff(0, [upper, []]), staff(3, [lower, []])], 2);
  const syllables = [0, 480, 960, 1440].map((tick) => syllable(tick, 'か'));

  test('gives each staff the syllables its channel sings', () => {
    expect(assignLyrics(model, [0, 1], syllables)).toEqual([
      [0, 1],
      [1, 2, 3],
    ]);
  });

  test('counts a note that starts within a sixteenth of the syllable', () => {
    expect(assignLyrics(model, [0, 1], [syllable(100, 'か'), syllable(121, 'え')])).toEqual([
      [0, 1],
      [],
    ]);
  });

  test('gives a syllable no channel sings to the first staff', () => {
    expect(assignLyrics(model, [0, 1], [syllable(BAR + 960, 'か')])).toEqual([[0], []]);
  });

  test('gives one staff every syllable', () => {
    expect(assignLyrics(model, [1], syllables)).toEqual([[0, 1, 2, 3]]);
  });

  test('returns nothing without staves', () => {
    expect(assignLyrics(model, [], syllables)).toEqual([]);
  });
});

describe('visibleSyllables', () => {
  test('drops syllables that are only whitespace', () => {
    const kept = [
      syllable(0, 'か'),
      syllable(10, ' a'),
      syllable(20, { kind: 'ruby', base: '空', reading: 'そら' }),
    ];
    const dropped = [syllable(30, ' '), syllable(40, '\t '), syllable(50)];
    expect(visibleSyllables([...dropped, ...kept])).toEqual(kept);
  });
});

describe('placeLyrics', () => {
  test('puts a syllable at the note that starts within a sixteenth of it', () => {
    const model = scoreModel([staff(0, [QUARTERS])], 1);
    const { geometry, placed } = place(model, [syllable(580, 'か'), syllable(1320, 'え')]);
    expect(placed.map((p) => p.x)).toEqual([
      tickToX(geometry, model.bars, 480),
      tickToX(geometry, model.bars, 1440),
    ]);
    expect(placed.map((p) => p.bar)).toEqual([0, 0]);
  });

  test('snaps to the earlier note when two are equally near', () => {
    const model = scoreModel([staff(0, [[item(0, 6), item(6, 6), item(12, 84, { keys: [] })]])], 1);
    const { geometry, placed } = place(model, [syllable(60, 'か')]);
    expect(placed[0]!.x).toBe(tickToX(geometry, model.bars, 0));
  });

  test('ignores tied items and rests', () => {
    const items = [
      item(0, 24),
      item(24, 24, { tieFromPrev: true }),
      item(48, 24, { keys: [] }),
      item(72, 24, { keys: [] }),
    ];
    const model = scoreModel([staff(0, [items])], 1);
    const { geometry, placed } = place(model, [syllable(500, 'か'), syllable(980, 'え')]);
    expect(placed.map((p) => p.x)).toEqual([
      tickToX(geometry, model.bars, 500),
      tickToX(geometry, model.bars, 980),
    ]);
  });

  test('keeps the tick position when no note starts nearby', () => {
    const model = scoreModel([staff(0, [QUARTERS])], 1);
    const { geometry, placed } = place(model, [syllable(680, 'か')]);
    expect(placed[0]!.x).toBe(tickToX(geometry, model.bars, 680));
  });

  test('pushes an overlapping syllable right of the one before it', () => {
    const model = scoreModel([staff(0, [QUARTERS])], 1);
    const { geometry, placed } = place(
      model,
      [syllable(0, 'かえりみち'), syllable(480, 'の'), syllable(960, 'う')],
      [150, 10, 10],
      4,
    );
    const x0 = tickToX(geometry, model.bars, 0);
    expect(placed.map((p) => p.x)).toEqual([x0, x0 + 154, x0 + 168]);
  });

  test('returns to the note once there is room', () => {
    const model = scoreModel([staff(0, [QUARTERS, QUARTERS])], 2);
    const { geometry, placed } = place(
      model,
      [syllable(0, 'かえりみち'), syllable(480, 'の'), syllable(BAR + 960, 'う')],
      [150, 10, 10],
      4,
    );
    expect(placed[2]!.x).toBe(tickToX(geometry, model.bars, BAR + 960));
    expect(placed[2]!.bar).toBe(1);
  });

  test('gives a pushed syllable the bar it lands in', () => {
    const model = scoreModel([staff(0, [QUARTERS, QUARTERS, QUARTERS])], 3);
    const one = place(model, [syllable(1440, 'か'), syllable(1500, 'え')], [50, 10], 4);
    expect(one.placed[1]!.x).toBeGreaterThan(one.geometry.x[1]!);
    expect(one.placed.map((p) => p.bar)).toEqual([0, 1]);
    const two = place(model, [syllable(1440, 'か'), syllable(1500, 'え')], [300, 10], 4);
    expect(two.placed[1]!.x).toBeGreaterThan(two.geometry.x[2]!);
    expect(two.placed.map((p) => p.bar)).toEqual([0, 2]);
  });

  test('snaps to notes on either staff of a grand staff', () => {
    const upper = [item(0, 24, { keys: [] }), item(24, 72)];
    const lower = [item(0, 96)];
    const model = scoreModel([staff(3, [upper]), staff(3, [lower], 'pitched', true)], 1);
    const { geometry, placed } = place(model, [syllable(400, 'か')], [1], 0, 1);
    expect(placed[0]!.x).toBe(tickToX(geometry, model.bars, 480));
  });

  test('does not snap to notes of other channels', () => {
    const model = scoreModel([staff(0, [QUARTERS]), staff(3, [[item(0, 96)]])], 1);
    const { geometry, placed } = place(model, [syllable(500, 'か')], [1], 0, 1);
    expect(placed[0]!.x).toBe(tickToX(geometry, model.bars, 500));
  });

  test('places syllables before the first bar and after the last', () => {
    const model = scoreModel([staff(0, [QUARTERS, QUARTERS])], 2);
    const { placed } = place(model, [syllable(-10, 'か'), syllable(BAR * 5, 'え')]);
    expect(placed.map((p) => p.bar)).toEqual([0, 1]);
  });

  test('returns nothing without a staff or bars', () => {
    const model = scoreModel([staff(0, [QUARTERS])], 1);
    expect(place(model, [syllable(0, 'か')], [1], 0, -1).placed).toEqual([]);
    expect(place(scoreModel([], 0), [syllable(0, 'か')]).placed).toEqual([]);
  });
});

describe('placeLyrics past the end of the score', () => {
  test('keeps syllables pushed past the last barline in the last bar', () => {
    const model = scoreModel([staff(0, [QUARTERS, QUARTERS])], 2);
    const { geometry, placed } = place(
      model,
      [syllable(BAR + 1440, 'か'), syllable(BAR + 1500, 'え'), syllable(BAR + 1560, 'り')],
      [400, 400, 10],
      4,
    );
    expect(placed[2]!.x).toBeGreaterThan(geometry.total);
    expect(placed.map((p) => p.bar)).toEqual([1, 1, 1]);
  });
});
