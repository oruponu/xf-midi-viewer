import { beforeAll, describe, expect, test } from 'bun:test';
import { SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import { measureSong, median, outputGainDb } from './outputGain.ts';
import { sf3DecoderReady } from './render.ts';
import { toSmf, voiceTestMidi } from './testMidi.ts';

SpessaLog.setLogLevel(false, false, false);

let bank: BasicSoundBank;
beforeAll(async () => {
  await sf3DecoderReady();
  bank = buildXgBank(readSoundBank(SOURCE_SOUND_BANK_PATH), NO_CORRECTIONS);
});

describe('measureSong', () => {
  test('measures a song shorter than 60 s over its own length', () => {
    const song = toSmf(voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [100]));
    const result = measureSong(bank, song)!;
    expect(Number.isFinite(result.loudness)).toBe(true);
    expect(result.peak).toBeGreaterThan(0);
  });

  test('skips data that is not a MIDI file', () => {
    expect(measureSong(bank, new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe('median', () => {
  test('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('outputGainDb', () => {
  test('rounds the median difference to 0.1 dB', () => {
    expect(outputGainDb([5.04, 6.26, 5.5])).toBe(5.5);
  });

  test('refuses to decide without any measured song', () => {
    expect(() => outputGainDb([])).toThrow('No song could be measured');
  });
});
