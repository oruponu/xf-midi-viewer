import type { ScoreBar } from './bars.ts';

// Score positions are in grid units of a 24th of a quarter note, which holds 32nds and triplets.
export const QUARTER = 24;
export const SIXTEENTH = 6;
const DOTTED_QUARTER = 36;
const EIGHTH = 12;
const EIGHTH_TRIPLET = 8;
const SIXTEENTH_TRIPLET = 4;
const THIRTY_SECOND = 3;

// Sequenced notes land on their grid to the nearest tick, so a grid fits when it is within a tick.
function exactWithin(gridTicks: number): number {
  return Math.min(1 / gridTicks, 0.5);
}
// A note played up to a 64th early still counts as the downbeat of the next beat.
const LEAD = 1.5;
// Played by hand, a beat is read as triplets only when the sixteenth grid misses a note by
// a 48th or more and the triplet grid fits it more than twice as well.
const TRIPLET_MISS = 2;

export interface Beat {
  start: number;
  len: number;
  // Grid within the beat: 8 or 4 for triplets, 6 or 3 for sixteenths and 32nds, 12 for swung eighths.
  step: number;
}

export interface Swing {
  eighths: boolean;
  sixteenths: boolean;
}

export const NO_SWING: Swing = { eighths: false, sixteenths: false };

export function isTripletStep(step: number): boolean {
  return step === EIGHTH_TRIPLET || step === SIXTEENTH_TRIPLET;
}

// Compound meters (6/8, 9/8, 12/8, ...) count in dotted quarters; all others, 3/8 and 2/2
// included, use quarter beats.
export function beatLength(bar: ScoreBar): number {
  const compound = bar.denominator === 8 && bar.numerator % 3 === 0 && bar.numerator > 3;
  return compound ? DOTTED_QUARTER : QUARTER;
}

export function barRange(bar: ScoreBar, gridTicks: number): [number, number] {
  const start = Math.round(bar.startTick / gridTicks);
  return [start, start + Math.round(bar.ticks / gridTicks)];
}

// Chooses, for each beat of the bars, the grid that the notes starting in it were written on.
export function buildBeats(
  startTicks: readonly number[],
  bars: readonly ScoreBar[],
  gridTicks: number,
  swing: Swing,
): Beat[] {
  const beats: Beat[] = [];
  for (const bar of bars) {
    const [b0, b1] = barRange(bar, gridTicks);
    const len = beatLength(bar);
    for (let s = b0; s < b1; s += len) {
      beats.push({ start: s, len: Math.min(len, b1 - s), step: SIXTEENTH });
    }
  }
  const offsets: number[][] = beats.map(() => []);
  for (const tick of startTicks) {
    const u = tick / gridTicks;
    const bi = beatIndexAt(beats, u, LEAD);
    if (bi >= 0) offsets[bi]!.push(u - beats[bi]!.start);
  }
  const exact = exactWithin(gridTicks);
  beats.forEach((b, bi) => {
    b.step = chooseStep(offsets[bi]!, b.len === QUARTER, swing, exact);
  });
  return beats;
}

// The last beat starting at or before u, counting lead units before each beat as part of it.
function beatIndexAt(beats: readonly Beat[], u: number, lead: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]!.start - lead <= u) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function beatAt(beats: readonly Beat[], pos: number): Beat | undefined {
  return beats[beatIndexAt(beats, pos, 0)];
}

export function snapToBeats(beats: readonly Beat[], u: number): number {
  const b = beats[beatIndexAt(beats, u, LEAD)];
  if (!b) return Math.round(u / SIXTEENTH) * SIXTEENTH;
  return b.start + Math.round((u - b.start) / b.step) * b.step;
}

function maxError(offsets: readonly number[], step: number): number {
  return Math.max(...offsets.map((o) => Math.abs(o - Math.round(o / step) * step)));
}

function onlyAt(offsets: readonly number[], positions: readonly number[], exact: number): boolean {
  return offsets.every((o) => positions.some((p) => Math.abs(o - p) <= exact));
}

function hasAt(offsets: readonly number[], position: number, exact: number): boolean {
  return offsets.some((o) => Math.abs(o - position) <= exact);
}

function chooseStep(
  offsets: readonly number[],
  quarterBeat: boolean,
  swing: Swing,
  exact: number,
): number {
  if (offsets.length === 0) return SIXTEENTH;
  if (quarterBeat && swing.sixteenths && onlyAt(offsets, [0, 8, 12, 20], exact)) return SIXTEENTH;
  if (quarterBeat && swing.eighths && onlyAt(offsets, [0, 16], exact)) return EIGHTH;
  const steps = quarterBeat
    ? [SIXTEENTH, EIGHTH_TRIPLET, SIXTEENTH_TRIPLET, THIRTY_SECOND]
    : [SIXTEENTH, THIRTY_SECOND];
  const fit = steps.find((s) => maxError(offsets, s) <= exact);
  if (fit !== undefined) return fit;
  if (quarterBeat) {
    const sixteenthMiss = maxError(offsets, SIXTEENTH);
    if (sixteenthMiss >= TRIPLET_MISS && maxError(offsets, EIGHTH_TRIPLET) < sixteenthMiss / 2) {
      return EIGHTH_TRIPLET;
    }
  }
  return SIXTEENTH;
}

interface SwingCounts {
  swungEighths: number;
  straightEighths: number;
  swungSixteenths: number;
  straightSixteenths: number;
}

const MIN_SWUNG_BEATS = 16;

// A song is in a shuffle when at least 16 beats are swung and they are at least half as many as
// the straight ones. Beats are counted per channel and quarter note over sequenced notes only,
// whatever the meter.
export function detectSwing(
  notes: readonly { channel: number; startTick: number }[],
  gridTicks: number,
): Swing {
  const beats = new Map<string, number[]>();
  for (const n of notes) {
    const u = n.startTick / gridTicks;
    const beat = Math.floor((u + LEAD) / QUARTER);
    const key = `${n.channel}:${beat}`;
    const list = beats.get(key);
    const offset = u - beat * QUARTER;
    if (list) list.push(offset);
    else beats.set(key, [offset]);
  }
  const c: SwingCounts = {
    swungEighths: 0,
    straightEighths: 0,
    swungSixteenths: 0,
    straightSixteenths: 0,
  };
  const exact = exactWithin(gridTicks);
  for (const offsets of beats.values()) {
    const has = (p: number) => hasAt(offsets, p, exact);
    if (has(16) && onlyAt(offsets, [0, 16], exact)) c.swungEighths += 1;
    if (onlyAt(offsets, [0, 6, 12, 18], exact)) {
      if (has(12)) c.straightEighths += 1;
      if (has(6) || has(18)) c.straightSixteenths += 1;
    }
    if ((has(12) || has(20)) && (has(8) || has(20)) && onlyAt(offsets, [0, 8, 12, 20], exact)) {
      c.swungSixteenths += 1;
    }
  }
  const swung = (s: number, straight: number) => s >= MIN_SWUNG_BEATS && s * 2 >= straight;
  return {
    eighths: swung(c.swungEighths, c.straightEighths),
    sixteenths: swung(c.swungSixteenths, c.straightSixteenths),
  };
}
