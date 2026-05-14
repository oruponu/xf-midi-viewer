import { describe, expect, test } from 'bun:test';
import { shiftChordBass, shiftChordRoot } from './transpose.ts';
import type { ChordRoot } from './types.ts';

describe('shiftChordRoot', () => {
  test('returns the same root when semitones is 0', () => {
    const root: ChordRoot = { note: 'C', accidental: 'natural' };
    expect(shiftChordRoot(root, 0, false)).toBe(root);
  });

  test('preserves the reserved root', () => {
    const root: ChordRoot = { note: 'reserved', accidental: 'natural' };
    expect(shiftChordRoot(root, 5, false)).toBe(root);
  });

  test.each([
    ['C', 'natural', 2, false, 'D', 'natural'],
    ['C', 'natural', 1, false, 'C', '#'],
    ['C', 'natural', 1, true, 'D', 'b'],
    ['B', 'b', 2, false, 'C', 'natural'],
    ['B', 'b', 2, true, 'C', 'natural'],
    ['F', '#', -1, false, 'F', 'natural'],
    ['F', '#', -7, true, 'B', 'natural'],
    ['G', 'natural', -2, true, 'F', 'natural'],
    ['E', 'b', 4, false, 'G', 'natural'],
    ['E', 'b', 3, true, 'G', 'b'],
  ] as const)(
    '%s%s shift %i preferFlats=%s -> %s%s',
    (note, acc, shift, preferFlats, expNote, expAcc) => {
      expect(
        shiftChordRoot({ note, accidental: acc }, shift, preferFlats),
      ).toEqual({ note: expNote, accidental: expAcc });
    },
  );

  test('normalizes double-sharp input', () => {
    // F## == G semitone-wise
    expect(shiftChordRoot({ note: 'F', accidental: '##' }, 1, false)).toEqual({
      note: 'G',
      accidental: '#',
    });
  });

  test('normalizes double-flat input', () => {
    // Dbb == C semitone-wise
    expect(shiftChordRoot({ note: 'D', accidental: 'bb' }, 2, false)).toEqual({
      note: 'D',
      accidental: 'natural',
    });
  });
});

describe('shiftChordBass', () => {
  test('shifts the bass root and preserves the type', () => {
    expect(
      shiftChordBass(
        { root: { note: 'C', accidental: 'natural' }, type: 'm' },
        2,
        false,
      ),
    ).toEqual({ root: { note: 'D', accidental: 'natural' }, type: 'm' });
  });

  test('returns the same bass when semitones is 0', () => {
    const bass = {
      root: { note: 'C', accidental: 'natural' } as ChordRoot,
      type: 'm',
    };
    expect(shiftChordBass(bass, 0, false)).toBe(bass);
  });
});
