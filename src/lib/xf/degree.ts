import type { KeySignature } from '../smf/timing.ts';
import { LEAD_SHEET_CHORD_TYPES } from './format.ts';
import { semitoneOf, tonicOf } from './transpose.ts';
import type { ChordBass, ChordRoot } from './types.ts';

const LETTERS = 'CDEFGAB';
const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const NUMERALS: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const AWKWARD_DEGREES: ReadonlySet<string> = new Set(['bI', '#III', 'bIV', '#VII']);

const SIMPLE_DEGREES: readonly string[] = [
  'I',
  'bII',
  'II',
  'bIII',
  'III',
  'IV',
  '#IV',
  'V',
  'bVI',
  'VI',
  'bVII',
  'VII',
];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function formatDegree(root: ChordRoot, key: KeySignature): string {
  if (root.note === 'reserved') return '?';
  const tonic = tonicOf(key);
  const step = mod(LETTERS.indexOf(root.note) - tonic.letter, 7);
  const interval = mod(semitoneOf(root) - tonic.semitone, 12);
  let offset = interval - MAJOR_SCALE[step]!;
  if (offset > 6) offset -= 12;
  if (offset < -6) offset += 12;
  const accidental = offset === 1 ? '#' : offset === -1 ? 'b' : '';
  const degree = accidental + NUMERALS[step]!;
  if (Math.abs(offset) >= 2 || AWKWARD_DEGREES.has(degree)) return SIMPLE_DEGREES[interval]!;
  return degree;
}

export function formatDegreeChord(
  root: ChordRoot,
  typeIndex: number,
  bass: ChordBass | null,
  key: KeySignature,
): string {
  const type = LEAD_SHEET_CHORD_TYPES[typeIndex]!;
  if (type === 'N.C.') return 'N.C.';
  let s = formatDegree(root, key) + type;
  if (bass) {
    s += '/' + formatDegree(bass.root, key);
    if (bass.typeIndex !== null) s += LEAD_SHEET_CHORD_TYPES[bass.typeIndex]!;
  }
  return s;
}
