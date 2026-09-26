import { describe, expect, test } from 'bun:test';
import type { PlaybackSequence } from '../smf/playback.ts';
import type { LyricSyllable } from './lyrics.ts';
import { nonLyricDurations } from './nonLyricDurations.ts';
import type { VocalPart } from './types.ts';

const sequence = (tempos: PlaybackSequence['tempos']): PlaybackSequence => ({
  notes: [],
  midiMessages: [],
  tempos,
  durationSeconds: 60,
  durationTicks: 57_600,
  ticksPerQuarter: 480,
  drumChannels: new Set(),
});

const at120 = sequence([{ tick: 0, seconds: 0, bpm: 120 }]);

const syl = (tick: number, text: string, vocalPart: VocalPart | null = 'solo'): LyricSyllable => ({
  tick,
  endTick: null,
  runs: [{ kind: 'text', text }],
  vocalPart,
});

describe('nonLyricDurations', () => {
  test('measures from a non-lyric marker to the next lyric syllable', () => {
    const intro = syl(0, 'イントロ', 'nonLyric');
    const interlude = syl(4800, '間奏', 'nonLyric');
    const syllables = [intro, syl(9600, 'あ'), syl(10_080, 'い'), interlude, syl(14_400, 'う')];

    const durations = nonLyricDurations(syllables, at120);

    expect(durations.get(intro)).toBe(10);
    expect(durations.get(interlude)).toBe(10);
    expect(durations.size).toBe(2);
  });

  test('skips a marker with no lyric after it', () => {
    const ending = syl(4800, 'エンド', 'nonLyric');

    expect(nonLyricDurations([syl(0, 'あ'), ending], at120).has(ending)).toBe(false);
  });

  test('skips a marker without text', () => {
    const blank = syl(0, ' ', 'nonLyric');

    expect(nonLyricDurations([blank, syl(960, 'あ')], at120).has(blank)).toBe(false);
  });

  test('measures up to the lyric after consecutive markers', () => {
    const first = syl(0, 'イントロ', 'nonLyric');
    const second = syl(960, '間奏', 'nonLyric');

    const durations = nonLyricDurations([first, second, syl(1920, 'あ')], at120);

    expect(durations.get(first)).toBe(2);
    expect(durations.get(second)).toBe(1);
  });

  test('follows tempo changes', () => {
    const interlude = syl(0, '間奏', 'nonLyric');
    const tempoChange = sequence([
      { tick: 0, seconds: 0, bpm: 120 },
      { tick: 960, seconds: 1, bpm: 60 },
    ]);

    expect(nonLyricDurations([interlude, syl(1440, 'あ')], tempoChange).get(interlude)).toBe(2);
  });
});
