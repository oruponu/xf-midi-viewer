import { XF_CHORD_TYPES } from './style.ts';
import type {
  ChordBass,
  ChordMessage,
  ChordRoot,
  FingeringContext,
  GuitarPart,
  GuitarStringVoicing,
  StyleMessage,
} from './types.ts';

export function formatChordRoot(r: ChordRoot): string {
  if (r.note === 'reserved') return '?';
  return r.note + (r.accidental === 'natural' ? '' : r.accidental);
}

export const LEAD_SHEET_CHORD_TYPES: readonly string[] = [
  '',
  '6',
  'M7',
  'M7(#11)',
  'add9',
  'M9',
  '69',
  'aug',
  'm',
  'm6',
  'm7',
  'm7(b5)',
  'madd9',
  'm9',
  'm11',
  'mM7',
  'mM9',
  'dim',
  'dim7',
  '7',
  '7sus4',
  '7(b5)',
  '9',
  '7(#11)',
  '13',
  '7(b9)',
  '7(b13)',
  '7(#9)',
  'augM7',
  'aug7',
  '1+8',
  '5',
  'sus4',
  'sus2',
  'N.C.',
];

export function formatChord(root: ChordRoot, typeIndex: number, bass: ChordBass | null): string {
  const type = LEAD_SHEET_CHORD_TYPES[typeIndex]!;
  if (type === 'N.C.') return 'N.C.';
  let s = formatChordRoot(root) + type;
  if (bass) {
    s += '/' + formatChordRoot(bass.root);
    if (bass.typeIndex !== null) s += LEAD_SHEET_CHORD_TYPES[bass.typeIndex]!;
  }
  return s;
}

function formatChordDetail({ root, typeIndex, bass }: ChordMessage): string {
  const parts = [
    `コードルート ${formatChordRoot(root)}`,
    `コードタイプ ${XF_CHORD_TYPES[typeIndex]!}`,
  ];
  if (bass) {
    parts.push(`オンベースノート ${formatChordRoot(bass.root)}`);
    if (bass.typeIndex !== null) parts.push(`ベースコード ${XF_CHORD_TYPES[bass.typeIndex]!}`);
  }
  return parts.join(', ');
}

const GUITAR_PART_LABELS: Record<GuitarPart, string> = {
  guitar: 'ギター',
  bass: 'ベース',
  ukulele: 'ウクレレ',
  reserved: '不明',
};

const FINGERING_CONTEXT_LABELS: Record<FingeringContext, string> = {
  keyboard: '通常鍵盤楽器運指',
  guitar: 'ギター運指',
  upStroke: 'アップストローク',
  downStroke: 'ダウンストローク',
  reserved: '不明',
};

const OPEN_STRING_FRET = 0;
const MUTED_STRING_FRET = 127;

function formatHand(hand: 'right' | 'left'): string {
  return hand === 'right' ? '右手' : '左手';
}

function formatChannel(channel: number | null): string {
  return channel === null ? '全CH共通' : `CH ${channel}`;
}

function formatPhraseLevel(level: number): string {
  if (level === 1) return `レベル${level} (ガイドフレーズレベル)`;
  if (level === 2) return `レベル${level} (モチーフ区切り)`;
  if (level >= 3 && level <= 7) return `レベル${level} (練習区切り)`;
  if (level === 8) return `レベル${level} (段落区切り)`;
  if (level === 9) return `レベル${level} (コーラス区切り)`;
  return `レベル${level}`;
}

function formatFinger(finger: number): string {
  if (finger === 0) return '押さえない';
  if (finger >= 1 && finger <= 5) return `指番号 ${finger}`;
  if (finger === 6) return 'ピック';
  return `不明 (${finger})`;
}

function formatVoicingString({ fret, finger }: GuitarStringVoicing, index: number): string {
  const string = `${index + 1}弦`;
  if (fret === MUTED_STRING_FRET) return `${string} 弾かない弦`;
  if (fret === OPEN_STRING_FRET) return `${string} 開放弦`;
  const pressed = `${string} ${fret}フレット`;
  return finger === 0 ? pressed : `${pressed} ${formatFinger(finger)}`;
}

export function formatStyleDetail(ev: StyleMessage): string {
  switch (ev.kind) {
    case 'chord':
      return formatChordDetail(ev);
    case 'rehearsal':
      return `${ev.letter}${"'".repeat(ev.variation)}`;
    case 'phraseMark':
      return `${formatHand(ev.hand)}, ${formatChannel(ev.channel)}, ${formatPhraseLevel(ev.level)}`;
    case 'maxPhraseMark':
      return `最大フレーズ数 ${ev.maxPhraseCount}`;
    case 'fingering':
      return `CH ${ev.channel}, ノート ${ev.noteNumber}, ${formatFinger(ev.fingering)}, ${formatHand(
        ev.hand,
      )}, ${FINGERING_CONTEXT_LABELS[ev.context]}`;
    case 'guideTrack':
      return `右手用 ${ev.rightHandChannel === null ? 'なし' : `CH ${ev.rightHandChannel}`} / 左手用 ${
        ev.leftHandChannel === null ? 'なし' : `CH ${ev.leftHandChannel}`
      }`;
    case 'guitarInfo':
      return `${GUITAR_PART_LABELS[ev.part]}, ${
        ev.channel === null ? '全CH共通' : `1弦 CH ${ev.channel}`
      }, カポ位置 ${ev.capo}, 各弦のノート番号: ${ev.stringNotes.join(', ')}`;
    case 'guitarVoicing':
      return `${formatChannel(ev.channel)}, ${ev.strings.map(formatVoicingString).join(' / ')}`;
  }
}
