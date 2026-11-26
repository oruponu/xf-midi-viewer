import { keyShiftAt } from '../smf/fixedKey.ts';
import type { KeyShiftChange } from '../smf/fixedKey.ts';
import { shiftKeySignature } from '../smf/timing.ts';
import type { KeySignature, KeySignatureChange, SmfTiming } from '../smf/timing.ts';
import { formatDegreeChord } from './degree.ts';
import { formatChord } from './format.ts';
import { transposeChord } from './transpose.ts';
import type { ChordMessage } from './types.ts';

const C_MAJOR: KeySignature = { sharps: 0, mode: 'major' };

function findKeySignatureAt(tick: number, changes: KeySignatureChange[]): KeySignature {
  if (changes.length === 0) return C_MAJOR;
  let result = changes[0]!.signature;
  for (const c of changes) {
    if (c.tick <= tick) result = c.signature;
    else break;
  }
  return result;
}

export function formatChordLabel(
  chord: ChordMessage,
  timing: SmfTiming,
  keyShifts: readonly KeyShiftChange[],
  degrees: boolean,
): string {
  if (degrees && timing.keySignatures.length > 0) {
    const key = findKeySignatureAt(chord.tick, timing.keySignatures);
    return formatDegreeChord(chord.root, chord.typeIndex, chord.bass, key);
  }
  const keyShift = keyShiftAt(chord.tick, keyShifts);
  if (keyShift === 0) return formatChord(chord.root, chord.typeIndex, chord.bass);
  const key = shiftKeySignature(findKeySignatureAt(chord.tick, timing.keySignatures), keyShift);
  const { root, bass } = transposeChord(chord.root, chord.typeIndex, chord.bass, keyShift, key);
  return formatChord(root, chord.typeIndex, bass);
}
