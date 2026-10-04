import type { PlaybackNote } from './playback.ts';

export interface ChannelNotes {
  starts: number[];
  ends: number[];
  maxEnds: number[][];
}

export type NoteActivity = readonly ChannelNotes[];

const CHANNEL_COUNT = 16;

export function buildNoteActivity(notes: readonly PlaybackNote[]): NoteActivity {
  const byChannel = Array.from({ length: CHANNEL_COUNT }, () => [] as PlaybackNote[]);
  for (const note of notes) byChannel[note.channel]?.push(note);
  return byChannel.map((channelNotes) => {
    const sorted = [...channelNotes].sort((a, b) => a.startSeconds - b.startSeconds);
    const starts = sorted.map((note) => note.startSeconds);
    const ends = sorted.map((note) => note.startSeconds + note.durationSeconds);
    return { starts, ends, maxEnds: buildMaxTable(ends) };
  });
}

export function soundingChannels(
  activity: NoteActivity,
  seconds: number,
  since: readonly number[],
): number {
  let mask = 0;
  activity.forEach((notes, channel) => {
    if (isSounding(notes, seconds, since[channel] ?? 0)) mask |= 1 << channel;
  });
  return mask;
}

function isSounding({ starts, maxEnds }: ChannelNotes, seconds: number, since: number) {
  const first = lowerBound(starts, since);
  const last = lowerBound(starts, seconds) - 1;
  return first <= last && rangeMax(maxEnds, first, last) > seconds;
}

function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildMaxTable(values: number[]): number[][] {
  const table = [values];
  for (let width = 2; width <= values.length; width *= 2) {
    const previous = table.at(-1)!;
    const half = width / 2;
    const row: number[] = [];
    for (let i = 0; i + width <= values.length; i += 1) {
      row.push(Math.max(previous[i]!, previous[i + half]!));
    }
    table.push(row);
  }
  return table;
}

function rangeMax(table: number[][], first: number, last: number): number {
  const level = Math.floor(Math.log2(last - first + 1));
  const row = table[level]!;
  return Math.max(row[first]!, row[last - (1 << level) + 1]!);
}
