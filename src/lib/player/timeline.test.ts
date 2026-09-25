import { describe, expect, test } from 'bun:test';
import {
  positionAt,
  pruneTimeline,
  timeAtPosition,
  TIMELINE_RETENTION_MS,
  withRateChange,
} from './timeline.ts';
import type { TimelineSegment } from './timeline.ts';

const base: TimelineSegment[] = [{ atMs: 1000, position: 0, rate: 1 }];

describe('positionAt', () => {
  test('returns 0 for an empty timeline', () => {
    expect(positionAt([], 5000)).toBe(0);
  });

  test('returns the first position before the first segment starts', () => {
    expect(positionAt([{ atMs: 1000, position: 5, rate: 1 }], 900)).toBe(5);
  });

  test('advances with the rate of the segment that contains the time', () => {
    const segments = withRateChange(base, 1500, 2);
    expect(positionAt(segments, 1250)).toBeCloseTo(0.25, 9);
    expect(positionAt(segments, 1500)).toBeCloseTo(0.5, 9);
    expect(positionAt(segments, 1600)).toBeCloseTo(0.7, 9);
  });
});

describe('timeAtPosition', () => {
  test('is the inverse of the segment position formula', () => {
    expect(timeAtPosition({ atMs: 1500, position: 0.5, rate: 2 }, 0.7)).toBeCloseTo(1600, 9);
  });
});

describe('withRateChange', () => {
  test('keeps the position continuous at the switch time', () => {
    const segments = withRateChange(base, 1400, 0.5);
    expect(segments).toHaveLength(2);
    expect(segments[1]!.position).toBeCloseTo(0.4, 9);
    expect(segments[1]!.rate).toBe(0.5);
  });

  test('replaces the last segment when the switch time is the same', () => {
    const segments = withRateChange([{ atMs: 1040, position: 5, rate: 1 }], 1040, 2);
    expect(segments).toEqual([{ atMs: 1040, position: 5, rate: 2 }]);
  });
});

describe('pruneTimeline', () => {
  test('drops segments that ended more than the retention before now', () => {
    const segments = withRateChange(withRateChange(base, 1500, 2), 2000, 1);
    const now = 2000 + TIMELINE_RETENTION_MS + 1;
    const pruned = pruneTimeline(segments, now);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.atMs).toBe(2000);
  });

  test('keeps results unchanged for times within the retention', () => {
    const segments = withRateChange(base, 1500, 2);
    const now = 1500 + TIMELINE_RETENTION_MS - 1;
    const pruned = pruneTimeline(segments, now);
    const t = now - TIMELINE_RETENTION_MS;
    expect(positionAt(pruned, t)).toBeCloseTo(positionAt(segments, t), 9);
  });
});
