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

const DRAG_TURN_PX = 50;

// A vertical scroll on a trackpad drifts sideways, so only a mostly horizontal wheel turns a page.
export function wheelTurn(deltaX: number, deltaY: number, shiftKey: boolean): 1 | -1 | 0 {
  const delta =
    deltaX === 0 && shiftKey ? deltaY : Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : 0;
  return delta === 0 ? 0 : delta > 0 ? 1 : -1;
}

export function dragTurn(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < DRAG_TURN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

const WHEEL_GESTURE_GAP_MS = 300;
const WHEEL_NOTCH_PX = 40;

// Turns pages from the horizontal wheel events it is fed, with deltas in pixels. A swipe arrives
// as a run of events, inertia included, and turns one page; a pause starts the next swipe. A
// stepped wheel, as a mouse wheel is, turns a page for every notch instead.
export function createWheelPager(): (
  delta: number,
  stepped: boolean,
  timeMs: number,
) => 1 | -1 | 0 {
  let lastMs = -Infinity;
  let sum = 0;
  return (delta, stepped, timeMs) => {
    const paused = timeMs - lastMs >= WHEEL_GESTURE_GAP_MS;
    lastMs = timeMs;
    const direction = delta > 0 ? 1 : -1;
    if (!stepped) return paused ? direction : 0;
    if (paused || sum * delta <= 0) sum = 0;
    sum += delta;
    if (Math.abs(sum) < WHEEL_NOTCH_PX) return 0;
    sum = 0;
    return direction;
  };
}
