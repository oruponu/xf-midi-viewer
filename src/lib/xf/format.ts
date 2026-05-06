import type { ChordBass, ChordRoot } from './types.ts';

export function formatChordRoot(r: ChordRoot): string {
  if (r.note === 'reserved') return '?';
  return r.note + (r.accidental === 'natural' ? '' : r.accidental);
}

export function formatChord(
  root: ChordRoot,
  type: string,
  bass: ChordBass | null,
): string {
  if (type === 'N.C.') return 'N.C.';
  let s = formatChordRoot(root) + type;
  if (bass) {
    s += '/' + formatChordRoot(bass.root) + bass.type;
  }
  return s;
}
