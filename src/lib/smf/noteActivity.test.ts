import { describe, expect, test } from 'bun:test';
import { buildNoteActivity, soundingChannels } from './noteActivity.ts';
import type { PlaybackNote } from './playback.ts';

const note = (channel: number, start: number, duration: number): PlaybackNote => ({
  channel,
  note: 60,
  velocity: 100,
  startTick: 0,
  endTick: 0,
  startSeconds: start,
  durationSeconds: duration,
});

const NO_SINCE: readonly number[] = new Array<number>(16).fill(0);

describe('soundingChannels', () => {
  test('sets the bit of every channel with a sounding note', () => {
    const activity = buildNoteActivity([note(0, 0, 1), note(3, 0.5, 0.2), note(5, 2, 1)]);

    expect(soundingChannels(activity, 0.6, NO_SINCE)).toBe((1 << 0) | (1 << 3));
  });

  test('returns 0 for a song without notes', () => {
    expect(soundingChannels(buildNoteActivity([]), 1, NO_SINCE)).toBe(0);
  });

  test('lights after the start and goes off at the end', () => {
    const activity = buildNoteActivity([note(2, 1, 1)]);

    expect(soundingChannels(activity, 1, NO_SINCE)).toBe(0);
    expect(soundingChannels(activity, 1.001, NO_SINCE)).toBe(1 << 2);
    expect(soundingChannels(activity, 1.999, NO_SINCE)).toBe(1 << 2);
    expect(soundingChannels(activity, 2, NO_SINCE)).toBe(0);
  });

  test('ignores notes that started before the channel since', () => {
    const activity = buildNoteActivity([note(0, 0, 4), note(0, 2.5, 0.5)]);
    const since = NO_SINCE.map((s, c) => (c === 0 ? 1 : s));

    expect(soundingChannels(activity, 2, since)).toBe(0);
    expect(soundingChannels(activity, 2.7, since)).toBe(1);
  });

  test('counts a note that starts exactly at the since', () => {
    const activity = buildNoteActivity([note(0, 1, 1)]);
    const since = NO_SINCE.map((s, c) => (c === 0 ? 1 : s));

    expect(soundingChannels(activity, 1.5, since)).toBe(1);
  });

  test('finds a long note under later short notes', () => {
    const activity = buildNoteActivity([note(0, 0, 10), note(0, 1, 0.2), note(0, 5, 0.2)]);

    expect(soundingChannels(activity, 6, NO_SINCE)).toBe(1);
  });

  test('ignores an earlier long note that started before the since', () => {
    const shorts = Array.from({ length: 100 }, (_, i) => note(0, 1 + i * 0.05, 0.04));
    const activity = buildNoteActivity([note(0, 0, 100), ...shorts]);
    const since = NO_SINCE.map((s, c) => (c === 0 ? 0.5 : s));

    expect(soundingChannels(activity, 50, since)).toBe(0);
    expect(soundingChannels(activity, 50, NO_SINCE)).toBe(1);
  });

  test('goes off between separate notes', () => {
    const activity = buildNoteActivity([note(0, 0, 1), note(0, 2, 1), note(0, 4, 1)]);

    expect(soundingChannels(activity, 3.5, NO_SINCE)).toBe(0);
    expect(soundingChannels(activity, 4.5, NO_SINCE)).toBe(1);
  });

  test('sorts notes by their start within each channel', () => {
    const activity = buildNoteActivity([note(1, 3, 1), note(1, 0, 1)]);

    expect(activity[1]!.starts).toEqual([0, 3]);
    expect(activity[1]!.ends).toEqual([1, 4]);
  });
});
