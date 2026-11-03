import { describe, expect, test } from 'bun:test';
import type { KeySignature } from '../smf/timing.ts';
import { formatDegreeChord } from './degree.ts';
import { LEAD_SHEET_CHORD_TYPES } from './format.ts';
import type { ChordBass, ChordRoot } from './types.ts';

const C_MAJOR: KeySignature = { sharps: 0, mode: 'major' };
const A_MINOR: KeySignature = { sharps: 0, mode: 'minor' };
const E_MAJOR: KeySignature = { sharps: 4, mode: 'major' };
const A_FLAT_MAJOR: KeySignature = { sharps: -4, mode: 'major' };
const C_MINOR: KeySignature = { sharps: -3, mode: 'minor' };

function root(name: string): ChordRoot {
  return {
    note: name[0] as ChordRoot['note'],
    accidental: (name.slice(1) || 'natural') as ChordRoot['accidental'],
  };
}

function typeIndexOf(type: string): number {
  const index = LEAD_SHEET_CHORD_TYPES.indexOf(type);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function degree(name: string, key: KeySignature): string {
  const [main, bassName] = name.split('/');
  const match = /^([A-G][#b]*)(.*)$/.exec(main!)!;
  let bass: ChordBass | null = null;
  if (bassName) {
    const bassMatch = /^([A-G][#b]*)(.*)$/.exec(bassName)!;
    bass = {
      root: root(bassMatch[1]!),
      typeIndex: bassMatch[2] ? typeIndexOf(bassMatch[2]) : null,
    };
  }
  return formatDegreeChord(root(match[1]!), typeIndexOf(match[2]!), bass, key);
}

describe('formatDegreeChord', () => {
  test('numbers the diatonic chords of a major key', () => {
    expect(
      ['CM7', 'Dm7', 'Em7', 'FM7', 'G7', 'Am7', 'Bm7(b5)'].map((c) => degree(c, C_MAJOR)),
    ).toEqual(['IM7', 'IIm7', 'IIIm7', 'IVM7', 'V7', 'VIm7', 'VIIm7(b5)']);
  });

  test('counts from the tonic of the key signature', () => {
    expect(degree('A', E_MAJOR)).toBe('IV');
    expect(degree('C#m', E_MAJOR)).toBe('VIm');
    expect(degree('Db', A_FLAT_MAJOR)).toBe('IV');
  });

  test('puts a flat or sharp before chords outside the major scale', () => {
    expect(degree('Bb', C_MAJOR)).toBe('bVII');
    expect(degree('Ab', C_MAJOR)).toBe('bVI');
    expect(degree('F#m7(b5)', C_MAJOR)).toBe('#IVm7(b5)');
    expect(degree('D#dim7', C_MAJOR)).toBe('#IIdim7');
  });

  test('counts a minor key against the major scale of its tonic', () => {
    expect(['Am', 'Bm7(b5)', 'C', 'Dm', 'E7', 'F', 'G'].map((c) => degree(c, A_MINOR))).toEqual([
      'Im',
      'IIm7(b5)',
      'bIII',
      'IVm',
      'V7',
      'bVI',
      'bVII',
    ]);
    expect(degree('G#dim7', A_MINOR)).toBe('VIIdim7');
    expect(degree('Eb', C_MINOR)).toBe('bIII');
  });

  test('respells roots that would need an awkward degree', () => {
    expect(degree('G#', A_FLAT_MAJOR)).toBe('I');
    expect(degree('C#m', A_FLAT_MAJOR)).toBe('IVm');
    expect(degree('Ab', E_MAJOR)).toBe('III');
    expect(degree('Cb', C_MAJOR)).toBe('VII');
    expect(degree('Dbb', C_MAJOR)).toBe('I');
  });

  test('writes the bass note as a degree', () => {
    expect(degree('C/E', C_MAJOR)).toBe('I/III');
    expect(degree('F/G', C_MAJOR)).toBe('IV/V');
    expect(degree('Ab/Bb', C_MAJOR)).toBe('bVI/bVII');
  });

  test('keeps the chord type of the bass chord', () => {
    expect(degree('D/Cm', C_MAJOR)).toBe('II/Im');
  });

  test('keeps N.C. as is', () => {
    expect(degree('CN.C.', C_MAJOR)).toBe('N.C.');
  });

  test('shows a reserved root as a question mark', () => {
    const reserved: ChordRoot = { note: 'reserved', accidental: 'natural' };
    expect(formatDegreeChord(reserved, 0, null, C_MAJOR)).toBe('?');
  });
});
