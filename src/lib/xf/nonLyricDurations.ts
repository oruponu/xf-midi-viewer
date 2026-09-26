import { tickToSeconds } from '../smf/playback.ts';
import type { PlaybackSequence } from '../smf/playback.ts';
import type { LyricSyllable } from './lyrics.ts';

export function nonLyricDurations(
  syllables: readonly LyricSyllable[],
  sequence: PlaybackSequence,
): Map<LyricSyllable, number> {
  const durations = new Map<LyricSyllable, number>();
  let nextLyricTick: number | null = null;
  for (let i = syllables.length - 1; i >= 0; i -= 1) {
    const syl = syllables[i]!;
    if (syl.vocalPart !== 'nonLyric') {
      nextLyricTick = syl.tick;
    } else if (nextLyricTick !== null && hasText(syl)) {
      durations.set(
        syl,
        tickToSeconds(nextLyricTick, sequence) - tickToSeconds(syl.tick, sequence),
      );
    }
  }
  return durations;
}

function hasText(syl: LyricSyllable): boolean {
  return syl.runs.some((run) => (run.kind === 'text' ? run.text : run.base).trim() !== '');
}
