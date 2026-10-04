import { describe, expect, test } from 'bun:test';
import type { KeySignature } from '../smf/timing.ts';
import { formatChord, LEAD_SHEET_CHORD_TYPES } from './format.ts';
import { transposeChord } from './transpose.ts';
import type { ChordBass, ChordRoot } from './types.ts';

const C_MAJOR: KeySignature = { sharps: 0, mode: 'major' };
const A_MINOR: KeySignature = { sharps: 0, mode: 'minor' };

function root(name: string): ChordRoot {
  return {
    note: name[0] as ChordRoot['note'],
    accidental: (name.slice(1) || 'natural') as ChordRoot['accidental'],
  };
}

function transposed(name: string, semitones: number, key: KeySignature): string {
  const [main, bassName] = name.split('/');
  const match = /^([A-G][#b]*)(.*)$/.exec(main!)!;
  const typeIndex = LEAD_SHEET_CHORD_TYPES.indexOf(match[2]!);
  expect(typeIndex).toBeGreaterThanOrEqual(0);
  const bass: ChordBass | null = bassName ? { root: root(bassName), typeIndex: null } : null;
  const result = transposeChord(root(match[1]!), typeIndex, bass, semitones, key);
  return formatChord(result.root, typeIndex, result.bass);
}

describe('transposeChord', () => {
  test('returns the same root and bass when semitones is 0', () => {
    const r = root('Bb');
    const bass = { root: root('D'), typeIndex: null };
    const result = transposeChord(r, 0, bass, 0, C_MAJOR);
    expect(result.root).toBe(r);
    expect(result.bass).toBe(bass);
  });

  test('preserves the reserved root', () => {
    const r: ChordRoot = { note: 'reserved', accidental: 'natural' };
    expect(transposeChord(r, 0, null, 5, C_MAJOR).root).toBe(r);
  });

  test.each([
    ['D', 'G'],
    ['Em7', 'Am7'],
    ['F', 'Bb'],
    ['Eb', 'Ab'],
    ['Bb7', 'Eb7'],
    ['Ab', 'Db'],
    ['Db', 'Gb'],
    ['Bbm', 'Ebm'],
    ['C#m7', 'F#m7'],
    ['C#m7(b5)', 'F#m7(b5)'],
    ['D#dim', 'G#dim'],
    ['G#dim7', 'C#dim7'],
  ])('spells %s up a fourth into C major as %s', (name, expected) => {
    expect(transposed(name, 5, C_MAJOR)).toBe(expected);
  });

  test.each([
    ['C', 'F'],
    ['B7', 'E7'],
    ['F', 'Bb'],
    ['Eb', 'Ab'],
    ['EbM7', 'AbM7'],
    ['D#dim', 'G#dim'],
    ['G#m', 'C#m'],
    ['C#m7', 'F#m7'],
  ])('spells %s up a fourth into A minor as %s', (name, expected) => {
    expect(transposed(name, 5, A_MINOR)).toBe(expected);
  });

  test.each([
    ['B7/D#', A_MINOR, 'E7/G#'],
    ['G/F', C_MAJOR, 'C/Bb'],
    ['A/C#', C_MAJOR, 'D/F#'],
    ['C/G', C_MAJOR, 'F/C'],
  ])('spells the bass of %s from the chord root', (name, key, expected) => {
    expect(transposed(name, 5, key)).toBe(expected);
  });

  test.each([
    ['Cdim/Gb', 'Ddim/Ab'],
    ['Cm7(b5)/Gb', 'Dm7(b5)/Ab'],
    ['C7(b5)/Gb', 'D7(b5)/Ab'],
    ['Caug/G#', 'Daug/A#'],
    ['Caug7/G#', 'Daug7/A#'],
  ])('spells the altered fifth bass of %s as %s', (name, expected) => {
    expect(transposed(name, 2, C_MAJOR)).toBe(expected);
  });

  test('keeps the key letters for diatonic notes', () => {
    expect(transposed('B', 6, { sharps: 6, mode: 'major' })).toBe('E#');
  });

  test('avoids Cb, Fb, E#, B# and double accidentals for notes outside the key', () => {
    expect(transposed('Bb', 1, { sharps: -5, mode: 'major' })).toBe('B');
  });
});
