import { barAtX, labelOverhang, tickToX } from './geometry.ts';
import type { BarGeometry } from './geometry.ts';
import type { ScoreModel } from './notation.ts';

export interface PlacedChord {
  // Bar whose cell holds the chord: the one x falls in.
  bar: number;
  // Left edge in score units, on the same axis as BarGeometry.x.
  x: number;
}

// Each chord starts at its tick, or right of the chord before it when that one is too wide.
// widths[i] is the width of the chord at ticks[i] in score units; the result keeps that order.
export function placeChords(
  model: ScoreModel,
  geometry: BarGeometry,
  ticks: readonly number[],
  widths: readonly number[],
  gap: number,
): PlacedChord[] {
  if (model.bars.length === 0) return [];
  // Chords read from several tracks are not in tick order.
  const order = ticks.map((_, i) => i).sort((a, b) => ticks[a]! - ticks[b]!);
  const placed = new Array<PlacedChord>(ticks.length);
  let free = -Infinity;
  for (const i of order) {
    const x = Math.max(tickToX(geometry, model.bars, ticks[i]!), free);
    free = x + (widths[i] ?? 0) + gap;
    placed[i] = { bar: barAtX(geometry, x), x };
  }
  return placed;
}

// Chords pushed past the end of the score sit in the last bar and run into the room after it, so
// the last bar does not count.
export function chordOverhang(
  placed: readonly PlacedChord[],
  widths: readonly number[],
  geometry: BarGeometry,
): number {
  const lastBar = geometry.width.length - 1;
  const inner = placed.flatMap((chord, i) =>
    chord.bar < lastBar ? [{ chord, width: widths[i] ?? 0 }] : [],
  );
  return labelOverhang(
    inner.map((c) => c.chord),
    inner.map((c) => c.width),
    geometry,
  );
}
