import { barAtX, tickToX } from './geometry.ts';
import type { BarGeometry } from './geometry.ts';
import type { ScoreModel } from './notation.ts';

export interface PlacedChord {
  // Bar whose cell holds the chord: the one x falls in.
  bar: number;
  // Left edge in score units, on the same axis as BarGeometry.x.
  x: number;
}

// Each chord starts at its tick, or right of the chord before it when that one is too wide.
// widths[i] is the width of the chord at ticks[i] in score units.
export function placeChords(
  model: ScoreModel,
  geometry: BarGeometry,
  ticks: readonly number[],
  widths: readonly number[],
  gap: number,
): PlacedChord[] {
  if (model.bars.length === 0) return [];
  let free = -Infinity;
  return ticks.map((tick, i) => {
    const x = Math.max(tickToX(geometry, model.bars, tick), free);
    free = x + (widths[i] ?? 0) + gap;
    return { bar: barAtX(geometry, x), x };
  });
}
