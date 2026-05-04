import type { SmfTrack } from '../smf/types.ts';
import type {
  ChordBass,
  ChordRoot,
  FingeringContext,
  GuitarPart,
  GuitarStringVoicing,
  RehearsalLetter,
  StyleMessage,
  XfStyleData,
} from './types.ts';

const YAMAHA_ID_HIGH = 0x43;
const YAMAHA_ID_LOW = 0x7b;

const NOTE_NAMES: ChordRoot['note'][] = [
  'reserved',
  'C',
  'D',
  'E',
  'F',
  'G',
  'A',
  'B',
];

const ACCIDENTALS: ChordRoot['accidental'][] = [
  'bbb',
  'bb',
  'b',
  'natural',
  '#',
  '##',
  '###',
];

export const CHORD_TYPES = [
  'Maj',
  'Maj6',
  'Maj7',
  'Maj7(#11)',
  'Maj(9)',
  'Maj7(9)',
  'Maj6(9)',
  'aug',
  'min',
  'min6',
  'min7',
  'min7b5',
  'min(9)',
  'min7(9)',
  'min7(11)',
  'minMaj7',
  'minMaj7(9)',
  'dim',
  'dim7',
  '7th',
  '7sus4',
  '7b5',
  '7(9)',
  '7(#11)',
  '7(13)',
  '7(b9)',
  '7(b13)',
  '7(#9)',
  'Maj7aug',
  '7aug',
  '1+8',
  '1+5',
  'sus4',
  '1+2+5',
  'cc',
] as const;

const REHEARSAL_LETTERS: RehearsalLetter[] = [
  'Intro',
  'Ending',
  'Fill-in',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
];

const GUITAR_PARTS: GuitarPart[] = ['guitar', 'bass', 'ukulele'];

const FINGERING_CONTEXTS: FingeringContext[] = [
  'keyboard',
  'guitar',
  'upStroke',
  'downStroke',
];

function decodeChordRoot(byte: number): ChordRoot | null {
  const fff = (byte >> 4) & 0x07;
  const nnnn = byte & 0x0f;
  if (fff > 6 || nnnn > 7) return null;
  return {
    note: NOTE_NAMES[nnnn]!,
    accidental: ACCIDENTALS[fff]!,
  };
}

export function parseStyleMessage(
  data: Uint8Array,
  tick: number,
): StyleMessage | null {
  if (data.length < 4) return null;
  if (data[0] !== YAMAHA_ID_HIGH || data[1] !== YAMAHA_ID_LOW) return null;
  const type = data[2]!;

  switch (type) {
    case 0x01:
      return parseChord(data, tick);
    case 0x02:
      return parseRehearsal(data, tick);
    case 0x03:
      return parsePhrase(data, tick);
    case 0x04:
      return parseMaxPhrase(data, tick);
    case 0x05:
      return parseFingering(data, tick);
    case 0x0c:
      return parseGuideTrack(data, tick);
    case 0x10:
      return parseGuitarInfo(data, tick);
    case 0x12:
      return parseGuitarVoicing(data, tick);
    default:
      return null;
  }
}

function parseChord(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 7) return null;
  const root = decodeChordRoot(data[3]!);
  if (root === null) return null;
  const typeIdx = data[4]!;
  if (typeIdx >= CHORD_TYPES.length) return null;
  const type = CHORD_TYPES[typeIdx]!;

  const bn = data[5]!;
  const bt = data[6]!;
  let bass: ChordBass | null = null;
  if (bn !== 127 && bt !== 127) {
    const bassRoot = decodeChordRoot(bn);
    if (bassRoot !== null && bt < CHORD_TYPES.length) {
      bass = { root: bassRoot, type: CHORD_TYPES[bt]! };
    }
  }

  return { kind: 'chord', tick, root, type, bass };
}

function parseRehearsal(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 4) return null;
  const rr = data[3]!;
  const xxxx = rr & 0x0f;
  const yyy = (rr >> 4) & 0x07;
  if (xxxx >= REHEARSAL_LETTERS.length) return null;
  return {
    kind: 'rehearsal',
    tick,
    letter: REHEARSAL_LETTERS[xxxx]!,
    variation: yyy,
  };
}

function parsePhrase(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 5) return null;
  const xx = data[3]!;
  const yy = data[4]!;
  if (yy < 1 || yy > 127) return null;
  const hand = ((xx >> 6) & 0x01) === 1 ? 'left' : 'right';
  const allCh = ((xx >> 5) & 0x01) === 1;
  const ccccc = xx & 0x1f;
  const channel = allCh ? null : ccccc + 1;
  return { kind: 'phraseMark', tick, hand, channel, level: yy };
}

function parseMaxPhrase(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 4) return null;
  return { kind: 'maxPhraseMark', tick, count: data[3]! + 1 };
}

function parseFingering(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 6) return null;
  const cc = data[3]!;
  const nn = data[4]!;
  const ff = data[5]!;
  const method = (cc >> 5) & 0x03;
  if (method !== 0) return null;
  const channel = (cc & 0x1f) + 1;
  const fff = ff & 0x07;
  const z = (ff >> 3) & 0x01;
  const yyy = (ff >> 4) & 0x07;
  const hand = z === 0 ? 'right' : 'left';
  const context = FINGERING_CONTEXTS[yyy] ?? 'reserved';
  return {
    kind: 'fingering',
    tick,
    channel,
    noteNumber: nn,
    fingering: fff,
    hand,
    context,
  };
}

function parseGuideTrack(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 5) return null;
  const rr = data[3]!;
  const ll = data[4]!;
  return {
    kind: 'guideTrack',
    tick,
    rightHandChannel: rr === 0 ? null : rr,
    leftHandChannel: ll === 0 ? null : ll,
  };
}

function parseGuitarInfo(data: Uint8Array, tick: number): StyleMessage | null {
  if (data.length < 6) return null;
  const xx = data[3]!;
  const pp = data[4]!;
  const kk = data[5]!;
  const allCh = ((xx >> 5) & 0x01) === 1;
  const ccccc = xx & 0x1f;
  const channel = allCh ? null : ccccc + 1;
  const part = GUITAR_PARTS[pp] ?? 'reserved';
  const stringNotes: number[] = [];
  for (let i = 6; i < data.length; i++) {
    stringNotes.push(data[i]!);
  }
  return { kind: 'guitarInfo', tick, channel, part, capo: kk, stringNotes };
}

function parseGuitarVoicing(
  data: Uint8Array,
  tick: number,
): StyleMessage | null {
  if (data.length < 4) return null;
  const xx = data[3]!;
  const allCh = ((xx >> 5) & 0x01) === 1;
  const ccccc = xx & 0x1f;
  const channel = allCh ? null : ccccc + 1;
  const strings: GuitarStringVoicing[] = [];
  for (let i = 4; i + 1 < data.length; i += 2) {
    strings.push({ fret: data[i]!, finger: data[i + 1]! });
  }
  return { kind: 'guitarVoicing', tick, channel, strings };
}

export function extractStyle(tracks: SmfTrack[]): XfStyleData {
  const events: StyleMessage[] = [];
  for (const track of tracks) {
    let tick = 0;
    for (const tev of track.events) {
      tick += tev.deltaTime;
      const ev = tev.event;
      if (ev.kind !== 'meta' || ev.metaType !== 0x7f) continue;
      const msg = parseStyleMessage(ev.data, tick);
      if (msg !== null) events.push(msg);
    }
  }
  return { events };
}
