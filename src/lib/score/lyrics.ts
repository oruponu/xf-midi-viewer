import type { LyricSyllable } from '../xf/lyrics.ts';
import { barAtX, offsetInBar, tickToX } from './geometry.ts';
import type { BarGeometry } from './geometry.ts';
import type { ScoreModel, ScoreStaff } from './notation.ts';
import { SIXTEENTH } from './subdivision.ts';

export interface PlacedLyric {
  syllable: LyricSyllable;
  // Bar whose cell holds the syllable: the one x falls in.
  bar: number;
  // Left edge in score units from the start of the strip (same axis as BarGeometry.x).
  x: number;
}

// Staves the lyrics go under, from the top: the last pitched staff of each melody channel.
// melodyChannels is 1-based, as in the XF header.
export function lyricStaffIndexes(
  staves: readonly ScoreStaff[],
  melodyChannels: readonly number[],
): number[] {
  const melody = (s: ScoreStaff) => s.kind === 'pitched' && melodyChannels.includes(s.channel + 1);
  return staves.flatMap((s, si) => {
    const next = staves[si + 1];
    const last = !next || next.kind !== 'pitched' || next.channel !== s.channel;
    return melody(s) && last ? [si] : [];
  });
}

export function visibleSyllables(syllables: readonly LyricSyllable[]): LyricSyllable[] {
  return syllables.filter((s) =>
    s.runs.some((run) => (run.kind === 'text' ? run.text.trim() !== '' : true)),
  );
}

interface Onset {
  tick: number;
  bar: number;
  // Ticks into the bar.
  into: number;
}

function noteOnsets(model: ScoreModel, channel: number): Onset[] {
  const onsets: Onset[] = [];
  for (const staff of model.staves) {
    if (staff.kind !== 'pitched' || staff.channel !== channel) continue;
    staff.bars.forEach((items, bar) => {
      const start = model.bars[bar]?.startTick;
      if (start === undefined) return;
      for (const it of items) {
        if (it.keys.length === 0 || it.tieFromPrev) continue;
        const into = it.startGrid * model.gridTicks;
        onsets.push({ tick: start + into, bar, into });
      }
    });
  }
  return onsets.sort((a, b) => a.tick - b.tick);
}

function nearestOnset(onsets: readonly Onset[], tick: number, within: number): Onset | undefined {
  let lo = 0;
  let hi = onsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (onsets[mid]!.tick < tick) lo = mid + 1;
    else hi = mid;
  }
  const before = onsets[lo - 1];
  const after = onsets[lo];
  const nearest =
    before && (!after || tick - before.tick <= after.tick - tick) ? before : (after ?? before);
  return nearest && Math.abs(nearest.tick - tick) <= within ? nearest : undefined;
}

// For each staff, the indexes of the syllables its channel sings: those with a note starting
// within a sixteenth. A syllable no channel sings goes to the first staff.
export function assignLyrics(
  model: ScoreModel,
  staffIndexes: readonly number[],
  syllables: readonly LyricSyllable[],
): number[][] {
  const within = SIXTEENTH * model.gridTicks;
  const onsets = staffIndexes.map((si) => noteOnsets(model, model.staves[si]!.channel));
  const assigned: number[][] = staffIndexes.map(() => []);
  syllables.forEach((syllable, i) => {
    const sung = onsets.flatMap((list, s) =>
      nearestOnset(list, syllable.tick, within) ? [s] : [],
    );
    for (const s of sung.length > 0 ? sung : [0]) assigned[s]?.push(i);
  });
  return assigned;
}

// Each syllable starts at the note it is sung on, or right of the syllable before it when that
// one is too wide. widths[i] is the width of syllables[i] in score units.
export function placeLyrics(
  model: ScoreModel,
  geometry: BarGeometry,
  staffIndex: number,
  syllables: readonly LyricSyllable[],
  widths: readonly number[],
  gap: number,
): PlacedLyric[] {
  const staff = model.staves[staffIndex];
  if (!staff || model.bars.length === 0) return [];
  const onsets = noteOnsets(model, staff.channel);
  const within = SIXTEENTH * model.gridTicks;
  let free = -Infinity;
  return syllables.map((syllable, i) => {
    const onset = nearestOnset(onsets, syllable.tick, within);
    const anchor = onset
      ? geometry.noteStart[onset.bar]! + offsetInBar(geometry, onset.bar, onset.into)
      : tickToX(geometry, model.bars, syllable.tick);
    const x = Math.max(anchor, free);
    free = x + (widths[i] ?? 0) + gap;
    return { syllable, bar: barAtX(geometry, x), x };
  });
}
