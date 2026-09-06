import { describe, expect, test } from 'bun:test';
import { scheduleDueMidiMessages } from './useMidiPlayer.ts';
import type { PlaybackMidiMessage } from '../lib/smf/playback.ts';

describe('scheduleDueMidiMessages', () => {
  test('advances past a failed message so the same message is not retried forever', () => {
    const messages: PlaybackMidiMessage[] = [
      { tick: 480, seconds: 0.5, data: [0x90, 60, 100] },
      { tick: 960, seconds: 1, data: [0x80, 60, 0] },
    ];
    const attempts: PlaybackMidiMessage[] = [];

    const result = scheduleDueMidiMessages(messages, 0, 0.45, 0.55, (message) => {
      attempts.push(message);
      return false;
    });

    expect(attempts).toEqual([messages[0]]);
    expect(result).toEqual({ nextIndex: 1, failed: true });
  });
});
