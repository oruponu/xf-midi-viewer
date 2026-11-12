import type { ScoreBar } from './bars.ts';
import type { ScoreModel, ScoreStaff } from './notation.ts';
import type { ScoreItem } from './rhythm.ts';

// All lengths are in VexFlow units, before the view scales them down.
export const LEFT_PAD = 16;
// The barline sits LEFT_PAD before the next downbeat, so a bar's last item needs room for a
// notehead (about 12), LEFT_PAD and a little over half a staff space before the barline.
export const LAST_ITEM_ROOM = 36;
export const FINAL_BARLINE_ROOM = 10;

export interface BarGeometry {
  x: number[];
  width: number[];
  prefix: number[];
  noteStart: number[];
  pxPerTick: number;
  tailStart: number[];
  tailPxPerTick: number[];
  total: number;
}

function itemLists(model: ScoreModel, bi: number): ScoreItem[][] {
  return model.staves.flatMap((s) => [s.bars[bi] ?? [], s.lowerBars?.[bi] ?? []]);
}

// Ticks map to x linearly within a bar, so notes never jump at a barline. The width a following
// bar's clef, key or time signature needs is taken from this bar's last segment, after the last
// item starts on any staff: only that segment scrolls a little faster, and no note starts in it.
export function buildGeometry(model: ScoreModel, prefixWidth: (bi: number) => number): BarGeometry {
  let finest = 16;
  let lastShortest = 16;
  model.bars.forEach((_, bi) => {
    for (const items of itemLists(model, bi)) {
      for (const it of items) if (it.keys.length > 0) finest = Math.min(finest, it.lenGrid);
      const last = items.at(-1);
      if (last) lastShortest = Math.min(lastShortest, last.lenGrid);
    }
  });
  const pxPerGrid = Math.max(
    finest <= 1 ? 32 : finest <= 2 ? 18 : 13,
    LAST_ITEM_ROOM / lastShortest,
  );
  const pxPerTick = pxPerGrid / model.gridTicks;
  const prefix = model.bars.map((_, bi) => prefixWidth(bi));

  const g: BarGeometry = {
    x: [],
    width: [],
    prefix,
    noteStart: [],
    pxPerTick,
    tailStart: [],
    tailPxPerTick: [],
    total: 0,
  };
  let cursor = 0;
  model.bars.forEach((bar, bi) => {
    const lastStart = Math.max(
      0,
      ...itemLists(model, bi).map((items) => items.at(-1)?.startGrid ?? 0),
    );
    const tailStart = lastStart * model.gridTicks;
    const nextPrefix = prefix[bi + 1] ?? 0;
    const endRoom = bi === model.bars.length - 1 ? FINAL_BARLINE_ROOM : 0;
    g.x.push(cursor);
    g.noteStart.push(cursor + prefix[bi]! + LEFT_PAD);
    g.tailStart.push(tailStart);
    g.tailPxPerTick.push(pxPerTick + nextPrefix / (bar.ticks - tailStart));
    g.width.push(prefix[bi]! + bar.ticks * pxPerTick + endRoom);
    cursor += g.width.at(-1)!;
  });
  g.total = cursor;
  return g;
}

export function offsetInBar(g: BarGeometry, bi: number, intoTicks: number): number {
  const tail = g.tailStart[bi]!;
  if (intoTicks <= tail) return intoTicks * g.pxPerTick;
  return tail * g.pxPerTick + (intoTicks - tail) * g.tailPxPerTick[bi]!;
}

export function tickToX(g: BarGeometry, bars: readonly ScoreBar[], tick: number): number {
  if (bars.length === 0) return 0;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]!.startTick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const bar = bars[lo]!;
  const into = Math.min(bar.ticks, Math.max(0, tick - bar.startTick));
  return g.noteStart[lo]! + offsetInBar(g, lo, into);
}

const STEP = 5;
const NOTEHEAD_HALF = 5;
// Diatonic step of each pitch class, with black keys spelled from the note below or above.
const STEP_DOWN = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const STEP_UP = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
// Diatonic steps of the top and bottom lines: F5 and E4, A3 and G2.
const OUTER_LINES = { treble: [38, 30], bass: [26, 18] } as const;

function diatonic(midi: number, steps: readonly number[]): number {
  return (Math.floor(midi / 12) - 1) * 7 + steps[midi % 12]!;
}

// How far noteheads reach above the top line and below the bottom line. Drum staves keep their
// notes on fixed positions near the staff.
export function staffOverhang(staff: ScoreStaff): { above: number; below: number } {
  if (staff.kind !== 'pitched' || staff.clef === 'percussion') return { above: 0, below: 0 };
  const [top, bottom] = OUTER_LINES[staff.clef];
  let above = 0;
  let below = 0;
  for (const it of staff.bars.flat()) {
    for (const k of it.keys) {
      above = Math.max(above, (diatonic(k, STEP_UP) - top) * STEP + NOTEHEAD_HALF);
      below = Math.max(below, (bottom - diatonic(k, STEP_DOWN)) * STEP + NOTEHEAD_HALF);
    }
  }
  return { above, below };
}
