import type { KeySignature } from '../smf/timing.ts';
import { XF_CHORD_TYPES } from './style.ts';
import type { ChordBass, ChordRoot } from './types.ts';

type Letter = Exclude<ChordRoot['note'], 'reserved'>;

const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_TO_SEMITONE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

const ACCIDENTAL_TO_OFFSET: Record<ChordRoot['accidental'], number> = {
  bbb: -3,
  bb: -2,
  b: -1,
  natural: 0,
  '#': 1,
  '##': 2,
  '###': 3,
};

const OFFSET_TO_ACCIDENTAL: Record<number, ChordRoot['accidental']> = {
  [-3]: 'bbb',
  [-2]: 'bb',
  [-1]: 'b',
  0: 'natural',
  1: '#',
  2: '##',
  3: '###',
};

const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

function chordTypes(...names: string[]): ReadonlySet<number> {
  return new Set(names.map((name) => XF_CHORD_TYPES.indexOf(name)));
}

const DIMINISHED_TYPES = chordTypes('dim', 'dim7', 'min7b5');
const MINOR_TYPES = chordTypes(
  'min',
  'min6',
  'min7',
  'min(9)',
  'min7(9)',
  'min7(11)',
  'minMaj7',
  'minMaj7(9)',
);
const FLAT_FIFTH_TYPES = chordTypes('dim', 'dim7', 'min7b5', '7b5');
const AUGMENTED_TYPES = chordTypes('aug', 'Maj7aug', '7aug');

const AWKWARD_NAMES: ReadonlySet<string> = new Set(['Cb', 'Fb', 'E#', 'B#']);

const SHARP_SPELLINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
  [2, 0],
  [3, 0],
  [3, 1],
  [4, 0],
  [4, 1],
  [5, 0],
  [5, 1],
  [6, 0],
];

const FLAT_SPELLINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -1],
  [1, 0],
  [2, -1],
  [2, 0],
  [3, 0],
  [4, -1],
  [4, 0],
  [5, -1],
  [5, 0],
  [6, -1],
  [6, 0],
];

interface Key {
  letter: number;
  semitone: number;
  scale: readonly number[];
  minor: boolean;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function semitoneOf(root: ChordRoot): number {
  const letter = LETTERS.indexOf(root.note as Letter);
  return mod(LETTER_TO_SEMITONE[letter]! + ACCIDENTAL_TO_OFFSET[root.accidental], 12);
}

function spell(letter: number, semitone: number): ChordRoot {
  let offset = semitone - LETTER_TO_SEMITONE[letter]!;
  if (offset > 6) offset -= 12;
  if (offset < -6) offset += 12;
  return { note: LETTERS[letter]!, accidental: OFFSET_TO_ACCIDENTAL[offset] ?? 'natural' };
}

function isAwkward(root: ChordRoot): boolean {
  const offset = ACCIDENTAL_TO_OFFSET[root.accidental];
  return Math.abs(offset) >= 2 || AWKWARD_NAMES.has(root.note + root.accidental);
}

function simplify(semitone: number, sharp: boolean): ChordRoot {
  const [letter, offset] = (sharp ? SHARP_SPELLINGS : FLAT_SPELLINGS)[semitone]!;
  return { note: LETTERS[letter]!, accidental: OFFSET_TO_ACCIDENTAL[offset]! };
}

function keyOf(signature: KeySignature): Key {
  const minor = signature.mode === 'minor';
  const majorLetter = mod(4 * signature.sharps, 7);
  const majorSemitone = mod(7 * signature.sharps, 12);
  return {
    letter: minor ? mod(majorLetter + 5, 7) : majorLetter,
    semitone: minor ? mod(majorSemitone + 9, 12) : majorSemitone,
    scale: minor ? MINOR_SCALE : MAJOR_SCALE,
    minor,
  };
}

function prefersSharp(key: Key, interval: number, typeIndex: number): boolean {
  if (DIMINISHED_TYPES.has(typeIndex)) return true;
  if (!MINOR_TYPES.has(typeIndex)) return false;
  return key.minor ? interval !== 1 : interval === 6;
}

function spellInKey(key: Key, semitone: number, sharp: (interval: number) => boolean): ChordRoot {
  const interval = mod(semitone - key.semitone, 12);
  const degree = key.scale.indexOf(interval);
  if (degree >= 0) return spell(mod(key.letter + degree, 7), semitone);
  const useSharp = sharp(interval);
  const neighbor = key.scale.indexOf(mod(interval + (useSharp ? -1 : 1), 12));
  const spelled = spell(mod(key.letter + neighbor, 7), semitone);
  return isAwkward(spelled) ? simplify(semitone, useSharp) : spelled;
}

const BASS_LETTER_STEPS: readonly number[] = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];

function bassLetterStep(interval: number, typeIndex: number): number {
  if (interval === 6 && FLAT_FIFTH_TYPES.has(typeIndex)) return 4;
  if (interval === 8 && AUGMENTED_TYPES.has(typeIndex)) return 4;
  return BASS_LETTER_STEPS[interval]!;
}

function spellBass(key: Key, root: ChordRoot, typeIndex: number, semitone: number): ChordRoot {
  const interval = mod(semitone - key.semitone, 12);
  if (key.scale.includes(interval)) return spellInKey(key, semitone, () => false);
  const rootLetter = LETTERS.indexOf(root.note as Letter);
  const step = bassLetterStep(mod(semitone - semitoneOf(root), 12), typeIndex);
  const spelled = spell(mod(rootLetter + step, 7), semitone);
  if (!isAwkward(spelled)) return spelled;
  return spellInKey(key, semitone, (i) => (key.minor ? i !== 1 : i === 6));
}

export function transposeChord(
  root: ChordRoot,
  typeIndex: number,
  bass: ChordBass | null,
  semitones: number,
  key: KeySignature,
): { root: ChordRoot; bass: ChordBass | null } {
  if (semitones === 0 || root.note === 'reserved') return { root, bass };
  const k = keyOf(key);
  const newRoot = spellInKey(k, mod(semitoneOf(root) + semitones, 12), (interval) =>
    prefersSharp(k, interval, typeIndex),
  );
  if (bass === null || bass.root.note === 'reserved') return { root: newRoot, bass };
  const bassSemitone = mod(semitoneOf(bass.root) + semitones, 12);
  return {
    root: newRoot,
    bass: { root: spellBass(k, newRoot, typeIndex, bassSemitone), typeIndex: bass.typeIndex },
  };
}
