import { describe, expect, test } from 'bun:test';
import type { KeySignatureChange, SmfTiming } from '../smf/timing.ts';
import { formatChordLabel } from './chordLabel.ts';
import { formatDegreeChord } from './degree.ts';
import { LEAD_SHEET_CHORD_TYPES } from './format.ts';
import type { ChordMessage, ChordRoot } from './types.ts';

const MAJOR = 0;
const MINOR7 = LEAD_SHEET_CHORD_TYPES.indexOf('m7');

const G_MAJOR: KeySignatureChange = { tick: 0, signature: { sharps: 1, mode: 'major' } };

function root(name: string): ChordRoot {
  return {
    note: name[0] as ChordRoot['note'],
    accidental: (name.slice(1) || 'natural') as ChordRoot['accidental'],
  };
}

const timing = (keys: KeySignatureChange[] = []): SmfTiming => ({
  ppq: 480,
  timeSignatures: [],
  keySignatures: keys,
});

const chord = (tick: number, name: string, typeIndex: number): ChordMessage => ({
  kind: 'chord',
  tick,
  root: root(name),
  typeIndex,
  bass: null,
});

describe('formatChordLabel', () => {
  test('formats the chord as written without a key shift', () => {
    expect(formatChordLabel(chord(0, 'A', MINOR7), timing(), [], false)).toBe('Am7');
  });

  test('transposes by the key shift in effect at the chord', () => {
    const shifts = [
      { tick: 0, semitones: 0 },
      { tick: 1920, semitones: -7 },
    ];
    expect(formatChordLabel(chord(0, 'G', MAJOR), timing([G_MAJOR]), shifts, false)).toBe('G');
    expect(formatChordLabel(chord(1920, 'G', MAJOR), timing([G_MAJOR]), shifts, false)).toBe('C');
  });

  test('writes degrees from the key signature when asked', () => {
    expect(formatChordLabel(chord(0, 'D', MAJOR), timing([G_MAJOR]), [], true)).toBe(
      formatDegreeChord(root('D'), MAJOR, null, G_MAJOR.signature),
    );
  });

  test('falls back to chord names for degrees without a key signature', () => {
    expect(formatChordLabel(chord(0, 'D', MAJOR), timing(), [], true)).toBe('D');
  });
});
