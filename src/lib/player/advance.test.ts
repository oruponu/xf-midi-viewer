import { describe, expect, test } from 'bun:test';
import { isPlaybackAdvance, MAX_PLAYBACK_ADVANCE_SECONDS } from './advance.ts';

describe('isPlaybackAdvance', () => {
  test('accepts a small forward step', () => {
    expect(isPlaybackAdvance(10, 10.033)).toBe(true);
  });

  test('accepts a step of exactly the maximum', () => {
    expect(isPlaybackAdvance(10, 10 + MAX_PLAYBACK_ADVANCE_SECONDS)).toBe(true);
  });

  test('rejects a step larger than the maximum', () => {
    expect(isPlaybackAdvance(10, 10 + MAX_PLAYBACK_ADVANCE_SECONDS + 0.01)).toBe(false);
  });

  test('rejects no movement', () => {
    expect(isPlaybackAdvance(10, 10)).toBe(false);
  });

  test('rejects a backward step', () => {
    expect(isPlaybackAdvance(10, 0)).toBe(false);
  });
});
