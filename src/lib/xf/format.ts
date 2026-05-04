import type { ChordBass, ChordRoot } from './types.ts';

export function formatChordRoot(r: ChordRoot): string {
  if (r.note === 'reserved') return '?';
  return r.note + (r.accidental === 'natural' ? '' : r.accidental);
}

export function formatChordType(type: string): string {
  if (type === 'Maj') return '';
  if (type.startsWith('min')) return 'm' + type.slice(3);
  return type;
}

export function formatChord(
  root: ChordRoot,
  type: string,
  bass: ChordBass | null,
): string {
  let s = formatChordRoot(root) + formatChordType(type);
  if (bass) {
    s += '/' + formatChordRoot(bass.root) + formatChordType(bass.type);
  }
  return s;
}
