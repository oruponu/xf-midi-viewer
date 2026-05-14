import type { ChordBass, ChordRoot } from './types.ts';

const NOTE_TO_SEMITONE: Record<
  Exclude<ChordRoot['note'], 'reserved'>,
  number
> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const ACCIDENTAL_TO_OFFSET: Record<ChordRoot['accidental'], number> = {
  bbb: -3,
  bb: -2,
  b: -1,
  natural: 0,
  '#': 1,
  '##': 2,
  '###': 3,
};

type Canonical = readonly [ChordRoot['note'], ChordRoot['accidental']];

const SHARP_NOTES: ReadonlyArray<Canonical> = [
  ['C', 'natural'],
  ['C', '#'],
  ['D', 'natural'],
  ['D', '#'],
  ['E', 'natural'],
  ['F', 'natural'],
  ['F', '#'],
  ['G', 'natural'],
  ['G', '#'],
  ['A', 'natural'],
  ['A', '#'],
  ['B', 'natural'],
];

const FLAT_NOTES: ReadonlyArray<Canonical> = [
  ['C', 'natural'],
  ['D', 'b'],
  ['D', 'natural'],
  ['E', 'b'],
  ['E', 'natural'],
  ['F', 'natural'],
  ['G', 'b'],
  ['G', 'natural'],
  ['A', 'b'],
  ['A', 'natural'],
  ['B', 'b'],
  ['B', 'natural'],
];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function shiftChordRoot(
  root: ChordRoot,
  semitones: number,
  preferFlats: boolean,
): ChordRoot {
  if (semitones === 0 || root.note === 'reserved') return root;
  const semitone = mod12(
    NOTE_TO_SEMITONE[root.note] + ACCIDENTAL_TO_OFFSET[root.accidental],
  );
  const target = mod12(semitone + semitones);
  const [note, accidental] = (preferFlats ? FLAT_NOTES : SHARP_NOTES)[target]!;
  return { note, accidental };
}

export function shiftChordBass(
  bass: ChordBass,
  semitones: number,
  preferFlats: boolean,
): ChordBass {
  if (semitones === 0) return bass;
  return {
    root: shiftChordRoot(bass.root, semitones, preferFlats),
    type: bass.type,
  };
}
