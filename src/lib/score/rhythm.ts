import type { ScoreBar } from './bars.ts';

export interface ScoreItem {
  startGrid: number;
  lenGrid: number;
  keys: number[];
  tieFromPrev: boolean;
}

export interface TimedNote {
  startTick: number;
  endTick: number;
  note: number;
}

interface Onset {
  start: number;
  end: number;
  keys: number[];
}

const DRUM_SUSTAIN = 4;
const NOTE_LENGTHS = [16, 12, 8, 6, 4, 3, 2, 1];
const REST_LENGTHS = [16, 8, 4, 2, 1];
const COMPOUND_REST_LENGTHS = [12, 6, 4, 2, 1];

// Returns, for each bar, its notes and rests with startGrid relative to the bar.
export function layoutNotes(
  notes: readonly TimedNote[],
  bars: readonly ScoreBar[],
  gridTicks: number,
  drums: boolean,
): ScoreItem[][] {
  const onsets = toOnsets(notes, gridTicks);
  onsets.forEach((o, i) => {
    const next = onsets[i + 1]?.start ?? Infinity;
    if (drums) o.end = Math.min(o.start + DRUM_SUSTAIN, Math.max(o.end, next));
    o.end = Math.min(o.end, next);
    if (!drums) o.end = notatedEnd(o, next, bars, gridTicks);
  });

  const result: ScoreItem[][] = [];
  let oi = 0;
  for (const bar of bars) {
    const b0 = Math.round(bar.startTick / gridTicks);
    const b1 = b0 + Math.round(bar.ticks / gridTicks);
    const items: ScoreItem[] = [];
    const beat = beatOf(bar);
    let cursor = b0;
    while (oi < onsets.length && onsets[oi]!.end <= b0) oi += 1;
    for (let j = oi; j < onsets.length && onsets[j]!.start < b1; j += 1) {
      const o = onsets[j]!;
      const s = Math.max(o.start, b0);
      const e = Math.min(o.end, b1);
      if (s > cursor) pushRests(items, cursor - b0, s - cursor, beat);
      const continued = o.start < b0;
      if (!drums) pushTied(items, s - b0, e - s, o.keys, continued, beat);
      else if (continued) pushRests(items, s - b0, e - s, beat);
      else pushUntied(items, s - b0, e - s, o.keys, beat);
      cursor = e;
    }
    if (cursor < b1) pushRests(items, cursor - b0, b1 - cursor, beat);
    const silent = items.every((it) => it.keys.length === 0);
    result.push(
      silent ? [{ startGrid: 0, lenGrid: b1 - b0, keys: [], tieFromPrev: false }] : items,
    );
  }
  return result;
}

function toOnsets(notes: readonly TimedNote[], gridTicks: number): Onset[] {
  const byStart = new Map<number, Onset>();
  for (const n of notes) {
    const start = Math.round(n.startTick / gridTicks);
    const end = Math.max(start + 1, Math.round(n.endTick / gridTicks));
    const onset = byStart.get(start);
    if (onset) {
      if (!onset.keys.includes(n.note)) onset.keys.push(n.note);
      onset.end = Math.max(onset.end, end);
    } else {
      byStart.set(start, { start, end, keys: [n.note] });
    }
  }
  const onsets = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (const o of onsets) o.keys.sort((a, b) => a - b);
  return onsets;
}

// Detached playing leaves gaps that would otherwise be spelled as a 16th rest after nearly every note.
function notatedEnd(
  o: Onset,
  nextStart: number,
  bars: readonly ScoreBar[],
  gridTicks: number,
): number {
  if (nextStart - o.end <= 1) return nextStart;
  if (o.end - o.start > 1) return o.end;
  return Math.min(nextStart, beatEndAfter(o.start, bars, gridTicks));
}

function beatEndAfter(pos: number, bars: readonly ScoreBar[], gridTicks: number): number {
  let bi = bars.length - 1;
  while (bi > 0 && Math.round(bars[bi]!.startTick / gridTicks) > pos) bi -= 1;
  const bar = bars[bi]!;
  const b0 = Math.round(bar.startTick / gridTicks);
  // A 32nd-note beat is shorter than the grid.
  const beat = Math.max(1, 16 / bar.denominator);
  return b0 + (Math.floor((pos - b0) / beat) + 1) * beat;
}

const QUARTER_BEAT = 4;
const DOTTED_QUARTER_BEAT = 6;

// Compound meters (6/8, 9/8, 12/8, ...) count in dotted quarters; all others, 3/8 and 2/2
// included, use quarter beats.
function beatOf(bar: ScoreBar): number {
  const compound = bar.denominator === 8 && bar.numerator % 3 === 0 && bar.numerator > 3;
  return compound ? DOTTED_QUARTER_BEAT : QUARTER_BEAT;
}

// Notes shorter than a beat stay within it; longer ones start on a beat.
function fitsAt(len: number, pos: number, beat: number): boolean {
  if (len < beat) return (pos % beat) + len <= beat;
  if (beat === DOTTED_QUARTER_BEAT) return len % beat === 0 && pos % len === 0;
  if (len === 12) return pos % 8 === 0;
  return pos % beat === 0;
}

function longestNote(pos: number, len: number, beat: number): number {
  return NOTE_LENGTHS.find((v) => v <= len && fitsAt(v, pos, beat)) ?? 1;
}

function pushTied(
  items: ScoreItem[],
  pos: number,
  len: number,
  keys: number[],
  continued: boolean,
  beat: number,
): void {
  let tie = continued;
  while (len > 0) {
    const l = longestNote(pos, len, beat);
    items.push({ startGrid: pos, lenGrid: l, keys, tieFromPrev: tie });
    pos += l;
    len -= l;
    tie = true;
  }
}

// Drum hits have no length worth tying, so whatever does not fit in one note becomes rests.
function pushUntied(
  items: ScoreItem[],
  pos: number,
  len: number,
  keys: number[],
  beat: number,
): void {
  const l = longestNote(pos, len, beat);
  items.push({ startGrid: pos, lenGrid: l, keys, tieFromPrev: false });
  if (len > l) pushRests(items, pos + l, len - l, beat);
}

// Rests are undotted and never cross a boundary of their own length, so they follow the beats.
// In compound meters they stay within a dotted-quarter beat instead, and only whole beats are dotted.
function restFitsAt(len: number, pos: number, beat: number): boolean {
  if (beat === DOTTED_QUARTER_BEAT) {
    if (len >= beat) return len % beat === 0 && pos % len === 0;
    return (pos % beat) + len <= beat && pos % Math.min(len, 2) === 0;
  }
  return pos % len === 0;
}

function pushRests(items: ScoreItem[], pos: number, len: number, beat: number): void {
  const lengths = beat === DOTTED_QUARTER_BEAT ? COMPOUND_REST_LENGTHS : REST_LENGTHS;
  while (len > 0) {
    const l = lengths.find((v) => v <= len && restFitsAt(v, pos, beat)) ?? 1;
    items.push({ startGrid: pos, lenGrid: l, keys: [], tieFromPrev: false });
    pos += l;
    len -= l;
  }
}

// In 4/4, a half bar of four plain eighth notes is beamed as one group; anything else per beat.
export function beamGroups(bar: ScoreBar, items: readonly ScoreItem[]): [number, number][] | null {
  if (bar.numerator !== 4 || bar.denominator !== 4) return null;
  const plainEighths = (h: number) => {
    const half = items.filter((it) => it.startGrid >= h * 8 && it.startGrid < h * 8 + 8);
    return (
      half.length === 4 &&
      half.every(
        (it, i) => it.startGrid === h * 8 + i * 2 && it.lenGrid === 2 && it.keys.length > 0,
      )
    );
  };
  const first = plainEighths(0);
  const second = plainEighths(1);
  if (first && second) return [[2, 4]];
  if (first)
    return [
      [2, 4],
      [1, 4],
      [1, 4],
    ];
  if (second)
    return [
      [1, 4],
      [1, 4],
      [2, 4],
    ];
  return [[1, 4]];
}
