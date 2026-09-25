import type { PlaybackNote } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import type { RehearsalMessage } from './types.ts';

const VIEW_QUARTER_NOTES = 16;
const MIN_ROWS = 12;

export interface PitchBarNote {
  note: number;
  startTick: number;
  endTick: number;
}

export interface PitchBarRehearsal {
  tick: number;
  label: string;
}

export interface PitchLane {
  lowNote: number;
  highNote: number;
  notes: PitchBarNote[];
  barTicks: number[];
  rehearsals: PitchBarRehearsal[];
  endTick: number;
  viewTicks: number;
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
  const endTick = bars.pop()!;
  return {
    ...noteRange(melody),
    notes: melody,
    barTicks: bars,
    rehearsals: rehearsals
      .filter((r) => r.tick >= 0 && r.tick < endTick)
      .map((r) => ({ tick: r.tick, label: r.letter + "'".repeat(r.variation) })),
    endTick,
    viewTicks: timing.ppq * VIEW_QUARTER_NOTES,
  };
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

// A time signature change always starts a new bar, as in tickToBarBeat.
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
