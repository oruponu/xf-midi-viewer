import { describe, expect, test } from 'bun:test';
import { rangeBands, rangeOffsets, steppedRangeOffsets } from './ranges.ts';

describe('rangeOffsets', () => {
  test('interpolates between the keys and keeps the end values outside them', () => {
    const offsets = rangeOffsets(
      [
        { key: 24, attenuationDelta: 0 },
        { key: 27, attenuationDelta: 30 },
        { key: 30, attenuationDelta: -30 },
      ],
      'test',
    );
    expect(offsets).toHaveLength(128);
    expect(offsets.slice(20, 32)).toEqual([0, 0, 0, 0, 0, 10, 20, 30, 10, -10, -30, -30]);
    expect(offsets[127]).toBe(-30);
  });

  test('rounds to whole centibels and ignores the order of the keys', () => {
    const offsets = rangeOffsets(
      [
        { key: 27, attenuationDelta: 10 },
        { key: 24, attenuationDelta: 0 },
      ],
      'test',
    );
    expect(offsets.slice(24, 28)).toEqual([0, 3, 7, 10]);
  });

  test('stops at keys that are missing, repeated or out of range', () => {
    expect(() => rangeOffsets([], 'Voice MSB 0 / PC 22')).toThrow(
      'Voice MSB 0 / PC 22: the range correction has no keys',
    );
    const at = (key: number) => ({ key, attenuationDelta: 0 });
    expect(() => rangeOffsets([at(24), at(24)], 'v')).toThrow('v: key 24 appears twice');
    expect(() => rangeOffsets([at(128)], 'v')).toThrow('v: key 128 is out of range');
    expect(() => rangeOffsets([at(-1)], 'v')).toThrow('v: key -1 is out of range');
    expect(() => rangeOffsets([at(24.5)], 'v')).toThrow('v: key 24.5 is out of range');
  });
});

describe('rangeBands', () => {
  const offsets = rangeOffsets(
    [
      { key: 24, attenuationDelta: 0 },
      { key: 27, attenuationDelta: 30 },
    ],
    'test',
  );

  test('merges neighbouring notes with the same delta', () => {
    expect(rangeBands(offsets, 0, 127)).toEqual([
      { min: 0, max: 24, delta: 0 },
      { min: 25, max: 25, delta: 10 },
      { min: 26, max: 26, delta: 20 },
      { min: 27, max: 127, delta: 30 },
    ]);
  });

  test('stays inside the given keys', () => {
    expect(rangeBands(offsets, 25, 26)).toEqual([
      { min: 25, max: 25, delta: 10 },
      { min: 26, max: 26, delta: 20 },
    ]);
  });
});

describe('steppedRangeOffsets', () => {
  const RISE = [
    { key: 60, attenuationDelta: 0 },
    { key: 72, attenuationDelta: 30 },
  ];

  test('rounds the interpolated deltas to multiples of the step', () => {
    const offsets = steppedRangeOffsets(RISE, 'test', 5);
    expect(offsets.slice(59, 68)).toEqual([0, 0, 5, 5, 10, 10, 15, 15, 20]);
    expect(offsets[0]).toBe(0);
    expect(offsets[127]).toBe(30);
  });

  test('matches rangeOffsets with a step of 1', () => {
    expect(steppedRangeOffsets(RISE, 'test', 1)).toEqual(rangeOffsets(RISE, 'test'));
  });

  test('never returns negative zero', () => {
    const offsets = steppedRangeOffsets(
      [
        { key: 60, attenuationDelta: 0 },
        { key: 61, attenuationDelta: -2 },
      ],
      'test',
      5,
    );
    expect(Object.is(offsets[61], 0)).toBe(true);
  });
});
