export type VocalTone = 'male' | 'female' | 'mixed' | 'none';

export interface VocalTypeBadge {
  label: string;
  tone: VocalTone;
}

// XF spec 2.01, Vocal Type: solo and chorus share a badge.
const BADGES: Record<string, VocalTypeBadge> = {
  m1: { label: '男声', tone: 'male' },
  mp: { label: '男声', tone: 'male' },
  f1: { label: '女声', tone: 'female' },
  fp: { label: '女声', tone: 'female' },
  fm: { label: '混声', tone: 'mixed' },
  no: { label: '歌なし', tone: 'none' },
};

export function vocalTypeBadge(code: string | undefined): VocalTypeBadge | null {
  if (code === undefined) return null;
  return Object.hasOwn(BADGES, code) ? BADGES[code]! : null;
}
