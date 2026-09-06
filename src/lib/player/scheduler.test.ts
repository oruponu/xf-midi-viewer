import { describe, expect, test } from 'bun:test';
import {
  clampKeyShift,
  clampPlaybackRate,
  firstMidiMessageIndexAtOrAfter,
  scheduleDueMidiMessages,
} from './scheduler.ts';
import type { PlaybackMidiMessage } from '../smf/playback.ts';

function msg(seconds: number, data: number[] = [0xc0, 0]): PlaybackMidiMessage {
  return { tick: Math.round(seconds * 960), seconds, data };
}

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

  test('skips live note-ons that are already in the past but keeps other messages', () => {
    const messages = [
      msg(0.1, [0x90, 60, 100]),
      msg(0.1, [0xb0, 7, 100]),
      msg(0.3, [0x90, 62, 100]),
      msg(0.5, [0x80, 62, 0]),
    ];
    const scheduled: number[][] = [];

    const result = scheduleDueMidiMessages(messages, 0, 0.2, 0.35, (m) => {
      scheduled.push(m.data);
      return true;
    });

    expect(scheduled).toEqual([
      [0xb0, 7, 100],
      [0x90, 62, 100],
    ]);
    expect(result).toEqual({ nextIndex: 3, failed: false });
  });
});

describe('clampPlaybackRate', () => {
  test('clamps to [0.5, 2.0], rounds to one decimal and falls back to 1 for NaN', () => {
    expect(clampPlaybackRate(3)).toBe(2);
    expect(clampPlaybackRate(0.1)).toBe(0.5);
    expect(clampPlaybackRate(1.26)).toBe(1.3);
    expect(clampPlaybackRate(Number.NaN)).toBe(1);
  });
});

describe('clampKeyShift', () => {
  test('clamps to [-6, 6], rounds to an integer and falls back to 0 for NaN', () => {
    expect(clampKeyShift(9)).toBe(6);
    expect(clampKeyShift(-7.6)).toBe(-6);
    expect(clampKeyShift(1.4)).toBe(1);
    expect(clampKeyShift(Number.NaN)).toBe(0);
  });
});

describe('firstMidiMessageIndexAtOrAfter', () => {
  const messages = [msg(0), msg(0.5), msg(0.5), msg(1)];

  test('returns the first index whose seconds is at or after the target', () => {
    expect(firstMidiMessageIndexAtOrAfter(messages, 0)).toBe(0);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.25)).toBe(1);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.5)).toBe(1);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.75)).toBe(3);
    expect(firstMidiMessageIndexAtOrAfter(messages, 2)).toBe(4);
  });
});
