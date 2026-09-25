import type { PlaybackNote } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import type { RehearsalMessage } from './types.ts';

const BARS_PER_SECTION = 4;
const MIN_ROWS = 12;

export interface PitchBarNote {
  note: number;
  startTick: number;
  endTick: number;
}

export interface PitchBarSection {
  startTick: number;
  endTick: number;
  barTicks: number[];
  notes: PitchBarNote[];
}

export interface PitchLane {
  lowNote: number;
  highNote: number;
  sections: PitchBarSection[];
}

export function buildPitchLane(
  notes: readonly PlaybackNote[],
  melodyChannels: readonly number[],
  timing: SmfTiming,
  rehearsals: readonly RehearsalMessage[],
  durationTicks: number,
): PitchLane | null {
  if (timing.ppq <= 0) return null;
  const channels = new Set(melodyChannels.map((ch) => ch - 1));
  const melody = notes
    .filter((n) => channels.has(n.channel))
    .map(({ note, startTick, endTick }) => ({ note, startTick, endTick }))
    .sort((a, b) => a.startTick - b.startTick || a.note - b.note);
  if (melody.length === 0) return null;

  const bars = barBoundaries(timing, durationTicks);
  const sections = sectionRanges(bars, rehearsals).map(([start, end]) => {
    const startTick = bars[start]!;
    const endTick = bars[end]!;
    return {
      startTick,
      endTick,
      barTicks: bars.slice(start + 1, end),
      notes: melody.filter((n) => n.startTick < endTick && n.endTick > startTick),
    };
  });
  return { ...noteRange(melody), sections };
}

export function findPitchBarSection(sections: readonly PitchBarSection[], tick: number): number {
  return lastIndexAtOrBefore(sections.length, (i) => sections[i]!.startTick, tick);
}

function noteRange(notes: readonly PitchBarNote[]): { lowNote: number; highNote: number } {
  let low = Infinity;
  let high = -Infinity;
  for (const n of notes) {
    low = Math.min(low, n.note);
    high = Math.max(high, n.note);
  }
  low -= 1;
  high += 1;
  const missing = MIN_ROWS - (high - low + 1);
  if (missing > 0) {
    low -= Math.floor(missing / 2);
    high += Math.ceil(missing / 2);
  }
  return { lowNote: low, highNote: high };
}

// Bar start ticks followed by the end of the last bar. A time signature change
// always starts a new bar, as in tickToBarBeat.
function barBoundaries(timing: SmfTiming, durationTicks: number): number[] {
  const segments = signatureSegments(timing);
  const end = Math.max(durationTicks, 1);
  const bounds: number[] = [];
  let lastBarEnd = 0;
  segments.forEach((seg, i) => {
    const segEnd = segments[i + 1]?.tick ?? Infinity;
    for (let t = seg.tick; t < segEnd && t < end; t += seg.barTicks) {
      bounds.push(t);
      lastBarEnd = Math.min(t + seg.barTicks, segEnd);
    }
  });
  bounds.push(lastBarEnd);
  return bounds;
}

function signatureSegments(timing: SmfTiming): { tick: number; barTicks: number }[] {
  const segments = [{ tick: 0, barTicks: timing.ppq * 4 }];
  for (const { tick, signature } of timing.timeSignatures) {
    const beatTicks = Math.max(1, Math.round((timing.ppq * 4) / signature.denominator));
    const segment = { tick, barTicks: beatTicks * Math.max(1, signature.numerator) };
    if (segments.at(-1)!.tick === tick) segments[segments.length - 1] = segment;
    else segments.push(segment);
  }
  return segments;
}

function sectionRanges(
  bars: readonly number[],
  rehearsals: readonly RehearsalMessage[],
): [number, number][] {
  const barCount = bars.length - 1;
  const marks = new Set<number>();
  for (const r of rehearsals) {
    if (r.tick >= 0 && r.tick < bars[barCount]!) {
      marks.add(lastIndexAtOrBefore(barCount, (i) => bars[i]!, r.tick));
    }
  }
  const ranges: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < barCount; i += 1) {
    if (i - start === BARS_PER_SECTION || marks.has(i)) {
      ranges.push([start, i]);
      start = i;
    }
  }
  ranges.push([start, barCount]);
  return ranges;
}

function lastIndexAtOrBefore(length: number, tickAt: (i: number) => number, tick: number): number {
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (tickAt(mid) <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
