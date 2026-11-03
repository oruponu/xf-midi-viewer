import { describe, expect, test } from 'bun:test';
import { vocalTypeBadge } from './vocalType.ts';
import type { VocalTypeBadge } from './vocalType.ts';

const CASES: [string, VocalTypeBadge][] = [
  ['m1', { label: '男声', tone: 'male' }],
  ['mp', { label: '男声', tone: 'male' }],
  ['f1', { label: '女声', tone: 'female' }],
  ['fp', { label: '女声', tone: 'female' }],
  ['fm', { label: '混声', tone: 'mixed' }],
  ['no', { label: '歌なし', tone: 'none' }],
];

describe('vocalTypeBadge', () => {
  test.each(CASES)('maps %s', (code, badge) => {
    expect(vocalTypeBadge(code)).toEqual(badge);
  });

  test('returns null for unknown or missing codes', () => {
    expect(vocalTypeBadge('xx')).toBeNull();
    expect(vocalTypeBadge(undefined)).toBeNull();
  });
});
