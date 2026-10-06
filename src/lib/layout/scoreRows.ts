import { tickToBarBeat } from '../smf/timing.ts';
import type { SmfTiming } from '../smf/timing.ts';

export interface ScoreRowSpec {
  startBar: number;
  barCount: number;
  barsPerRow: number;
}

export type BarFit = (bar: number, barsPerRow: number) => boolean;

export function buildScoreRows(
  totalBars: number,
  barsPerRow: number,
  sectionStartBars: Iterable<number>,
  fits: BarFit = () => true,
): ScoreRowSpec[] {
  const breaks = [...new Set(sectionStartBars)]
    .filter((bar) => bar > 1 && bar <= totalBars)
    .sort((a, b) => a - b);
  breaks.push(totalBars + 1);
  const rows: ScoreRowSpec[] = [];
  let start = 1;
  for (const end of breaks) {
    for (let s = start; s < end; s += barsPerRow) {
      pushFittedRows(rows, s, Math.min(barsPerRow, end - s), barsPerRow, fits);
    }
    start = end;
  }
  return rows;
}

function pushFittedRows(
  rows: ScoreRowSpec[],
  startBar: number,
  barCount: number,
  barsPerRow: number,
  fits: BarFit,
): void {
  const end = startBar + barCount;
  let allFit = true;
  for (let bar = startBar; bar < end && allFit; bar += 1) allFit = fits(bar, barsPerRow);
  if (allFit || barsPerRow <= 1) {
    rows.push({ startBar, barCount, barsPerRow });
    return;
  }
  const next = Math.floor(barsPerRow / 2);
  for (let s = startBar; s < end; s += next) {
    pushFittedRows(rows, s, Math.min(next, end - s), next, fits);
  }
}

export function countScoreBars(
  markTicks: readonly number[],
  endTick: number,
  timing: SmfTiming,
): number {
  if (markTicks.length === 0) return 0;
  let lastTick = endTick - 1;
  for (const tick of markTicks) lastTick = Math.max(lastTick, tick);
  return tickToBarBeat(lastTick, timing)?.bar ?? 1;
}
