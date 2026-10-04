import { describe, expect, test } from 'bun:test';
import { isChannelAudible, silencedChannels } from './channelMask.ts';

const ALL_CHANNELS = Array.from({ length: 16 }, (_, channel) => channel);

describe('isChannelAudible', () => {
  test('without solo, plays every channel that is not muted', () => {
    expect(isChannelAudible(0, 0, 0)).toBe(true);
    expect(isChannelAudible(0b100, 0, 2)).toBe(false);
    expect(isChannelAudible(0b100, 0, 3)).toBe(true);
  });

  test('with solo, plays only soloed channels whether they are muted or not', () => {
    expect(isChannelAudible(0, 0b10, 1)).toBe(true);
    expect(isChannelAudible(0b10, 0b10, 1)).toBe(true);
    expect(isChannelAudible(0, 0b10, 0)).toBe(false);
  });

  test('returns to the mute state when solo is cleared', () => {
    const muted = 0b101;
    expect(ALL_CHANNELS.filter((c) => isChannelAudible(muted, 0b10, c))).toEqual([1]);
    expect(ALL_CHANNELS.filter((c) => !isChannelAudible(muted, 0, c))).toEqual([0, 2]);
  });
});

describe('silencedChannels', () => {
  test('lists the channels that go from audible to silent', () => {
    expect(silencedChannels(0, 0, 0b100, 0)).toEqual([2]);
    expect(silencedChannels(0b100, 0, 0b100, 0b1)).toEqual(
      ALL_CHANNELS.filter((c) => c !== 0 && c !== 2),
    );
  });

  test('lists nothing when channels only become audible', () => {
    expect(silencedChannels(0b100, 0, 0, 0)).toEqual([]);
    expect(silencedChannels(0, 0b1, 0, 0)).toEqual([]);
  });
});
