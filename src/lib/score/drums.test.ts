import { describe, expect, test } from 'bun:test';
import { drumSetKey, isDrumSetNote, isFootNote, percussionKey, percussionName } from './drums.ts';

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('drum notes', () => {
  test('classifies drum set and foot notes', () => {
    const kit = [...range(25, 29), 31, ...range(33, 38), ...range(40, 53), 55, 57, 59];
    for (const n of range(0, 127)) expect(isDrumSetNote(n)).toBe(kit.includes(n));
    for (const n of range(0, 127)) expect(isFootNote(n)).toBe([33, 35, 36, 44].includes(n));
  });

  test('places drum set notes as in band scores', () => {
    expect([36, 38, 37, 42, 44, 49, 51, 43, 50, 47].map((n) => [n, drumSetKey(n)])).toEqual([
      [36, 'f/4'],
      [38, 'c/5'],
      [37, 'c/5/x2'],
      [42, 'g/5/x2'],
      [44, 'd/4/x2'],
      [49, 'a/5/x2'],
      [51, 'f/5/x2'],
      [43, 'a/4'],
      [50, 'e/5'],
      [47, 'd/5'],
    ]);
  });

  test('falls back to a cross on the middle line for unknown notes', () => {
    expect(drumSetKey(99)).toBe('b/4/x2');
    expect(percussionKey(99)).toBe('b/4/x2');
  });

  test('names percussion instruments', () => {
    expect([54, 82, 39, 99].map(percussionName)).toEqual(['Tamb.', 'Shaker', 'Clap', '#99']);
  });
});
