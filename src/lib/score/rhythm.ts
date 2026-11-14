import type { ScoreBar } from './bars.ts';
import {
  barRange,
  beatAt,
  beatLength,
  buildBeats,
  isTripletStep,
  QUARTER,
  SIXTEENTH,
  snapToBeats,
} from './subdivision.ts';
import type { Beat, Swing } from './subdivision.ts';

export interface ScoreItem {
  startGrid: number;
  lenGrid: number;
  keys: number[];
  tieFromPrev: boolean;
  // Length of the triplet the item is written in: an eighth for sixteenth-note triplets, a quarter
  // for eighth-note triplets, a half for quarter-note triplets. The triplet starts at the multiple
  // of its length at or before the item.
  triplet?: number;
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

const DRUM_SUSTAIN = QUARTER;
const NOTE_LENGTHS = [96, 72, 48, 36, 24, 18, 12, 9, 6, 3];
const REST_LENGTHS = [96, 48, 24, 12, 6, 3];
const COMPOUND_REST_LENGTHS = [72, 36, 24, 12, 6, 3];
const TRIPLET_NOTE_LENGTHS = [32, 24, 16, 12, 8, 4];
const TRIPLET_REST_LENGTHS = [16, 8, 4];
const DOTTED_QUARTER = 36;
const DOTTED_HALF = 72;

// Returns, for each bar, its notes and rests with startGrid relative to the bar.
export function layoutNotes(
  notes: readonly TimedNote[],
  bars: readonly ScoreBar[],
  gridTicks: number,
  drums: boolean,
  swing: Swing,
): ScoreItem[][] {
  const beats = buildBeats(
    notes.map((n) => n.startTick),
    bars,
    gridTicks,
    swing,
  );
  const onsets = toOnsets(notes, beats, gridTicks);
  onsets.forEach((o, i) => {
    const next = onsets[i + 1]?.start ?? Infinity;
    if (drums) o.end = drumEnd(o, next, beats);
    o.end = Math.min(o.end, next);
    if (!drums) o.end = notatedEnd(o, next, beats);
  });

  const result: ScoreItem[][] = [];
  let oi = 0;
  let bi = 0;
  for (const bar of bars) {
    const [b0, b1] = barRange(bar, gridTicks);
    const items: ScoreItem[] = [];
    const beat = beatLength(bar);
    const tripletBeats: TripletBeat[] = [];
    for (; bi < beats.length && beats[bi]!.start < b1; bi += 1) {
      const b = beats[bi]!;
      if (isTripletStep(b.step)) {
        tripletBeats.push({ index: (b.start - b0) / beat, step: b.step, len: b.len });
      }
    }
    while (oi < onsets.length && onsets[oi]!.end <= b0) oi += 1;
    const meter: BarMeter = { beat, groups: tripletGroups(tripletBeats, b0, beat, onsets, oi) };
    let cursor = b0;
    for (let j = oi; j < onsets.length && onsets[j]!.start < b1; j += 1) {
      const o = onsets[j]!;
      const s = Math.max(o.start, b0);
      const e = Math.min(o.end, b1);
      if (s > cursor) pushRests(items, cursor - b0, s - cursor, meter);
      const continued = o.start < b0;
      if (!drums) pushTied(items, s - b0, e - s, o.keys, continued, meter);
      else if (continued) pushRests(items, s - b0, e - s, meter);
      else pushUntied(items, s - b0, e - s, o.keys, meter);
      cursor = e;
    }
    if (cursor < b1) pushRests(items, cursor - b0, b1 - cursor, meter);
    const silent = items.every((it) => it.keys.length === 0);
    result.push(
      silent ? [{ startGrid: 0, lenGrid: b1 - b0, keys: [], tieFromPrev: false }] : items,
    );
  }
  return result;
}

interface TripletBeat {
  index: number;
  step: number;
  len: number;
}

// Two full triplet beats starting on an even beat form one quarter-note triplet when a note
// sounds across the beat between them. A beat of sixteenth-note triplets longer than an eighth
// splits into two triplets unless a note sounds across its middle.
function tripletGroups(
  tripletBeats: readonly TripletBeat[],
  b0: number,
  beat: number,
  onsets: readonly Onset[],
  from: number,
): Map<number, TripletGroup[]> {
  const groups = new Map<number, TripletGroup[]>();
  const crosses = (mid: number, since: number) => {
    for (let j = from; j < onsets.length && onsets[j]!.start < mid; j += 1) {
      const o = onsets[j]!;
      if (o.start >= since && o.end > mid) return true;
    }
    return false;
  };
  const whole = (k: number) => tripletBeats.some((t) => t.index === k && t.len === beat);
  for (const { index: k, step, len } of tripletBeats) {
    if (groups.has(k)) continue;
    const start = k * beat;
    const next = b0 + start + beat;
    if (k % 2 === 0 && whole(k) && whole(k + 1) && crosses(next, next - beat)) {
      const group = { start, len: 2 * beat };
      groups.set(k, [group]);
      groups.set(k + 1, [group]);
      continue;
    }
    const span = 3 * step;
    const split = span < len && !crosses(b0 + start + span, -Infinity);
    groups.set(
      k,
      split
        ? [
            { start, len: span },
            { start: start + span, len: span },
          ]
        : [{ start, len }],
    );
  }
  return groups;
}

// End of the three-step triplet that pos falls in, before tripletGroups joins any triplets.
function tripletEnd(beat: Beat, pos: number): number {
  const span = 3 * beat.step;
  return beat.start + (Math.floor((pos - beat.start) / span) + 1) * span;
}

function stepAt(beats: readonly Beat[], pos: number): number {
  return beatAt(beats, pos)?.step ?? SIXTEENTH;
}

// A hit is written up to a quarter long. A quarter on from a hit can fall off the grid of the
// beat it reaches, and a hit in a triplet stays within it so no odd rests follow it.
function drumEnd(o: Onset, nextStart: number, beats: readonly Beat[]): number {
  const end = snapToBeats(beats, Math.min(o.start + DRUM_SUSTAIN, Math.max(o.end, nextStart)));
  const beat = beatAt(beats, o.start);
  return beat && isTripletStep(beat.step) ? Math.min(end, tripletEnd(beat, o.start)) : end;
}

function toOnsets(notes: readonly TimedNote[], beats: readonly Beat[], gridTicks: number): Onset[] {
  const byStart = new Map<number, Onset>();
  for (const n of notes) {
    const start = snapToBeats(beats, n.startTick / gridTicks);
    const end = Math.max(start + stepAt(beats, start), snapToBeats(beats, n.endTick / gridTicks));
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
function notatedEnd(o: Onset, nextStart: number, beats: readonly Beat[]): number {
  if (nextStart - o.end <= SIXTEENTH) return nextStart;
  if (o.end - o.start > SIXTEENTH) return o.end;
  const beat = beatAt(beats, o.start);
  if (!beat) return o.end;
  const end = isTripletStep(beat.step) ? tripletEnd(beat, o.start) : beat.start + beat.len;
  return Math.min(nextStart, end);
}

interface TripletGroup {
  start: number;
  len: number;
}

interface BarMeter {
  beat: number;
  // Triplets by the index of each beat they cover, in order.
  groups: Map<number, TripletGroup[]>;
}

// A piece shorter than a beat stays within it; a longer one starts on a beat. Neither covers
// only part of a triplet.
function fitsAt(len: number, pos: number, meter: BarMeter): boolean {
  const { beat } = meter;
  const end = pos + len;
  for (let k = Math.floor(pos / beat); k * beat < end; k += 1) {
    for (const g of meter.groups.get(k) ?? []) {
      const overlaps = g.start < end && g.start + g.len > pos;
      if (overlaps && (g.start < pos || g.start + g.len > end)) return false;
    }
  }
  if (len < beat) return (pos % beat) + len <= beat;
  if (beat === DOTTED_QUARTER) return len % beat === 0 && pos % len === 0;
  if (len === DOTTED_HALF) return pos % 48 === 0;
  return pos % beat === 0;
}

// Rests are undotted and never cross a boundary of their own length, so they follow the beats.
// In compound meters they stay within a dotted-quarter beat instead, and only whole beats are dotted.
function restFitsAt(len: number, pos: number, meter: BarMeter): boolean {
  const { beat } = meter;
  if (beat === DOTTED_QUARTER) {
    if (len >= beat) return len % beat === 0 && pos % len === 0;
    return (pos % beat) + len <= beat && pos % Math.min(len, 12) === 0;
  }
  return pos % len === 0;
}

// The triplet a piece is written in, unless the piece covers all of it.
function tripletAt(pos: number, len: number, meter: BarMeter): TripletGroup | undefined {
  const g = meter.groups.get(Math.floor(pos / meter.beat))?.find((t) => pos < t.start + t.len);
  return g && (pos !== g.start || len < g.len) ? g : undefined;
}

interface Piece {
  len: number;
  triplet?: number;
}

function notePiece(pos: number, len: number, meter: BarMeter): Piece {
  const g = tripletAt(pos, len, meter);
  if (g) {
    const room = Math.min(len, g.start + g.len - pos);
    return { len: TRIPLET_NOTE_LENGTHS.find((v) => v <= room) ?? room, triplet: g.len };
  }
  return { len: NOTE_LENGTHS.find((v) => v <= len && fitsAt(v, pos, meter)) ?? Math.min(len, 3) };
}

function restPiece(pos: number, len: number, meter: BarMeter): Piece {
  const g = tripletAt(pos, len, meter);
  if (g) {
    const room = Math.min(len, g.start + g.len - pos);
    const fits = (v: number) => v <= room && (pos - g.start) % Math.min(v, 8) === 0;
    return { len: TRIPLET_REST_LENGTHS.find(fits) ?? room, triplet: g.len };
  }
  const lengths = meter.beat === DOTTED_QUARTER ? COMPOUND_REST_LENGTHS : REST_LENGTHS;
  return { len: lengths.find((v) => v <= len && restFitsAt(v, pos, meter)) ?? Math.min(len, 3) };
}

function item(pos: number, piece: Piece, keys: number[], tieFromPrev: boolean): ScoreItem {
  const it: ScoreItem = { startGrid: pos, lenGrid: piece.len, keys, tieFromPrev };
  if (piece.triplet) it.triplet = piece.triplet;
  return it;
}

function pushTied(
  items: ScoreItem[],
  pos: number,
  len: number,
  keys: number[],
  continued: boolean,
  meter: BarMeter,
): void {
  let tie = continued;
  while (len > 0) {
    const piece = notePiece(pos, len, meter);
    items.push(item(pos, piece, keys, tie));
    pos += piece.len;
    len -= piece.len;
    tie = true;
  }
}

// Drum hits have no length worth tying, so whatever does not fit in one note becomes rests.
function pushUntied(
  items: ScoreItem[],
  pos: number,
  len: number,
  keys: number[],
  meter: BarMeter,
): void {
  const piece = notePiece(pos, len, meter);
  items.push(item(pos, piece, keys, false));
  if (len > piece.len) pushRests(items, pos + piece.len, len - piece.len, meter);
}

function pushRests(items: ScoreItem[], pos: number, len: number, meter: BarMeter): void {
  while (len > 0) {
    const piece = restPiece(pos, len, meter);
    items.push(item(pos, piece, [], false));
    pos += piece.len;
    len -= piece.len;
  }
}

// In 4/4, a half bar of four plain eighth notes is beamed as one group; anything else per beat.
export function beamGroups(bar: ScoreBar, items: readonly ScoreItem[]): [number, number][] | null {
  if (bar.numerator !== 4 || bar.denominator !== 4) return null;
  const half = 2 * QUARTER;
  const eighth = QUARTER / 2;
  const plainEighths = (h: number) => {
    const inHalf = items.filter((it) => it.startGrid >= h * half && it.startGrid < (h + 1) * half);
    return (
      inHalf.length === 4 &&
      inHalf.every(
        (it, i) =>
          it.startGrid === h * half + i * eighth &&
          it.lenGrid === eighth &&
          it.keys.length > 0 &&
          !it.triplet,
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
