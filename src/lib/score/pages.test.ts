import { describe, expect, test } from 'bun:test';
import { LEFT_PAD } from './geometry.ts';
import type { BarGeometry } from './geometry.ts';
import type { ScoreBar } from './bars.ts';
import { buildScorePages, pageIndexAt, pageStartTick, turnPage } from './pages.ts';

const BAR = 1920;

function barsOf(count: number): ScoreBar[] {
  return Array.from({ length: count }, (_, i) => ({
    startTick: i * BAR,
    ticks: BAR,
    numerator: 4,
    denominator: 4,
    timeChanged: i === 0,
    keySharps: 0,
    keyChanged: false,
    sectionStart: false,
  }));
}

// Ticks advance in proportion to the bar's width.
function geometryOf(widths: number[]): BarGeometry {
  const x: number[] = [];
  let cursor = 0;
  for (const w of widths) {
    x.push(cursor);
    cursor += w;
  }
  return {
    x,
    width: widths,
    prefix: widths.map(() => 0),
    noteStart: x.map((v) => v + LEFT_PAD),
    pxPerTick: 0,
    tailStart: widths.map(() => 0),
    tailPxPerTick: widths.map((w) => w / BAR),
    total: cursor,
  };
}

const WIDTHS = [400, 400, 400, 300, 1000, 2500, 200];
const g = geometryOf(WIDTHS);
const bars = barsOf(WIDTHS.length);
const pages = buildScorePages(g, 1000);

describe('buildScorePages', () => {
  test('packs bars while they fit and splits a bar wider than the page', () => {
    expect(pages).toEqual([
      { start: 0, end: 800, firstBar: 0, lastBar: 1 },
      { start: 800, end: 1500, firstBar: 2, lastBar: 3 },
      { start: 1500, end: 2500, firstBar: 4, lastBar: 4 },
      { start: 2500, end: 3500, firstBar: 5, lastBar: 5 },
      { start: 3500, end: 4500, firstBar: 5, lastBar: 5 },
      { start: 4500, end: 5000, firstBar: 5, lastBar: 5 },
      { start: 5000, end: 5200, firstBar: 6, lastBar: 6 },
    ]);
  });

  test('covers the whole strip without gaps or overlaps', () => {
    for (const width of [150, 640, 1000, 9999]) {
      const built = buildScorePages(g, width);
      expect(built[0]!.start).toBe(0);
      expect(built.at(-1)!.end).toBe(g.total);
      built.slice(1).forEach((p, i) => expect(p.start).toBe(built[i]!.end));
    }
  });

  test('treats a page narrower than the minimum as the minimum', () => {
    expect(buildScorePages(g, 0)).toEqual(buildScorePages(g, 100));
    expect(buildScorePages(g, -50)).toEqual(buildScorePages(g, 100));
  });

  test('returns no pages without bars', () => {
    expect(buildScorePages(geometryOf([]), 1000)).toEqual([]);
  });
});

describe('pageIndexAt', () => {
  test('finds the page of the bar that contains the tick', () => {
    expect(pageIndexAt(pages, g, bars, 0)).toBe(0);
    expect(pageIndexAt(pages, g, bars, 2 * BAR)).toBe(1);
    expect(pageIndexAt(pages, g, bars, 6 * BAR)).toBe(6);
  });

  test('stays on the page until the tick leaves its last bar', () => {
    // The playhead x is already past the page end here.
    expect(pageIndexAt(pages, g, bars, 2 * BAR - 1)).toBe(0);
  });

  test('advances by x inside a split bar', () => {
    expect(pageIndexAt(pages, g, bars, 5 * BAR)).toBe(3);
    expect(pageIndexAt(pages, g, bars, 5 * BAR + BAR / 2)).toBe(4);
    expect(pageIndexAt(pages, g, bars, 6 * BAR - 1)).toBe(5);
  });

  test('clamps ticks outside the song', () => {
    expect(pageIndexAt(pages, g, bars, -1)).toBe(0);
    expect(pageIndexAt(pages, g, bars, Infinity)).toBe(6);
  });

  test('returns -1 without pages', () => {
    expect(pageIndexAt([], geometryOf([]), [], 0)).toBe(-1);
  });
});

describe('pageStartTick', () => {
  test('is the start of the first bar on a page that starts at a barline', () => {
    expect(pageStartTick(pages[1]!, g, bars)).toBe(2 * BAR);
  });

  test('is the tick at the page start inside a split bar', () => {
    const expected = 5 * BAR + (3500 - (2500 + LEFT_PAD)) / (2500 / BAR);
    expect(pageStartTick(pages[4]!, g, bars)).toBeCloseTo(expected);
  });
});

describe('turnPage', () => {
  test('moves one page and stops at both ends', () => {
    expect(turnPage(pages, 2, 1)).toBe(3);
    expect(turnPage(pages, 2, -1)).toBe(1);
    expect(turnPage(pages, 0, -1)).toBe(0);
    expect(turnPage(pages, 6, 1)).toBe(6);
  });
});
