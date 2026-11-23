import type { ScoreBar } from './bars.ts';
import { barAtTick, tickToX, xToTick } from './geometry.ts';
import type { BarGeometry } from './geometry.ts';

export const MIN_PAGE_WIDTH = 100;

export interface ScorePage {
  // x range in score units, end exclusive
  start: number;
  end: number;
  firstBar: number;
  lastBar: number;
}

// Pages tile the strip. A bar wider than the page is cut into pages of its own.
export function buildScorePages(g: BarGeometry, pageWidth: number): ScorePage[] {
  const width = Math.max(pageWidth, MIN_PAGE_WIDTH);
  const pages: ScorePage[] = [];
  let bi = 0;
  while (bi < g.width.length) {
    const start = g.x[bi]!;
    const barEnd = start + g.width[bi]!;
    if (g.width[bi]! > width) {
      for (let x = start; x < barEnd; x += width) {
        pages.push({ start: x, end: Math.min(x + width, barEnd), firstBar: bi, lastBar: bi });
      }
      bi += 1;
      continue;
    }
    let last = bi;
    let end = barEnd;
    while (last + 1 < g.width.length && end + g.width[last + 1]! - start <= width) {
      last += 1;
      end += g.width[last]!;
    }
    pages.push({ start, end, firstBar: bi, lastBar: last });
    bi = last + 1;
  }
  return pages;
}

// The page follows the bar the tick is in, not the playhead's x: the x runs into the next bar's
// left padding before the tick leaves the bar.
export function pageIndexAt(
  pages: readonly ScorePage[],
  g: BarGeometry,
  bars: readonly ScoreBar[],
  tick: number,
): number {
  const bi = barAtTick(bars, tick);
  const first = pages.findIndex((p) => p.firstBar <= bi && bi <= p.lastBar);
  if (first < 0) return -1;
  const x = tickToX(g, bars, tick);
  let index = first;
  while (pages[index + 1]?.firstBar === bi && pages[index]!.end <= x) index += 1;
  return index;
}

export function pageStartTick(page: ScorePage, g: BarGeometry, bars: readonly ScoreBar[]): number {
  if (page.start <= g.noteStart[page.firstBar]!) return bars[page.firstBar]!.startTick;
  return xToTick(g, bars, page.start);
}

export function turnPage(pages: readonly ScorePage[], index: number, direction: 1 | -1): number {
  return Math.min(pages.length - 1, Math.max(0, index + direction));
}
