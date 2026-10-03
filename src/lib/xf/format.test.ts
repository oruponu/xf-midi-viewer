import { describe, expect, test } from 'bun:test';
import { formatStyleDetail } from './format.ts';
import type { StyleMessage } from './types.ts';

type Fingering = Extract<StyleMessage, { kind: 'fingering' }>;

const fingering = (overrides: Partial<Fingering>): Fingering => ({
  kind: 'fingering',
  tick: 0,
  channel: 1,
  noteNumber: 60,
  fingering: 1,
  hand: 'right',
  context: 'keyboard',
  ...overrides,
});

describe('formatStyleDetail - chord and rehearsal', () => {
  test('formats chord with bass', () => {
    expect(
      formatStyleDetail({
        kind: 'chord',
        tick: 0,
        root: { note: 'C', accidental: 'natural' },
        type: 'M7',
        bass: { root: { note: 'G', accidental: 'natural' }, type: '' },
      }),
    ).toBe('CM7/G');
  });

  test('formats rehearsal variation with primes', () => {
    expect(formatStyleDetail({ kind: 'rehearsal', tick: 0, letter: 'A', variation: 2 })).toBe(
      "A''",
    );
  });
});

describe('formatStyleDetail - phrase marks', () => {
  test('formats all-channel level 8 phrase mark with its meaning', () => {
    expect(
      formatStyleDetail({ kind: 'phraseMark', tick: 0, hand: 'right', channel: null, level: 8 }),
    ).toBe('右手, 全CH共通, レベル8 (段落区切り)');
  });

  test('formats channel-specific level 1 phrase mark', () => {
    expect(
      formatStyleDetail({ kind: 'phraseMark', tick: 0, hand: 'left', channel: 2, level: 1 }),
    ).toBe('左手, CH 2, レベル1 (ガイドフレーズレベル)');
  });

  test.each([
    [2, 'レベル2 (モチーフ区切り)'],
    [3, 'レベル3 (練習区切り)'],
    [7, 'レベル7 (練習区切り)'],
    [9, 'レベル9 (コーラス区切り)'],
    [10, 'レベル10'],
  ])('formats level %i', (level, expected) => {
    expect(
      formatStyleDetail({ kind: 'phraseMark', tick: 0, hand: 'right', channel: null, level }),
    ).toBe(`右手, 全CH共通, ${expected}`);
  });

  test('formats max phrase count', () => {
    expect(formatStyleDetail({ kind: 'maxPhraseMark', tick: 0, maxPhraseCount: 11 })).toBe(
      '最大フレーズ数 11',
    );
  });
});

describe('formatStyleDetail - fingering', () => {
  test('formats pick on keyboard fingering', () => {
    expect(formatStyleDetail(fingering({ fingering: 6 }))).toBe(
      'CH 1, ノート 60, ピック, 右手, 通常鍵盤楽器運指',
    );
  });

  test.each([
    [0, '押さえない'],
    [1, '指番号 1'],
    [5, '指番号 5'],
    [7, '不明 (7)'],
  ])('formats finger %i', (finger, expected) => {
    expect(formatStyleDetail(fingering({ fingering: finger, hand: 'left' }))).toBe(
      `CH 1, ノート 60, ${expected}, 左手, 通常鍵盤楽器運指`,
    );
  });

  test.each([
    ['guitar', 'ギター運指'],
    ['upStroke', 'アップストローク'],
    ['downStroke', 'ダウンストローク'],
    ['reserved', '不明'],
  ] as const)('formats %s context', (context, expected) => {
    expect(formatStyleDetail(fingering({ context }))).toBe(
      `CH 1, ノート 60, 指番号 1, 右手, ${expected}`,
    );
  });
});

describe('formatStyleDetail - guide track and guitar', () => {
  test('formats guide track channels', () => {
    expect(
      formatStyleDetail({
        kind: 'guideTrack',
        tick: 0,
        rightHandChannel: 1,
        leftHandChannel: null,
      }),
    ).toBe('右手用 CH 1 / 左手用 なし');
  });

  test('formats guitar info with first string channel', () => {
    expect(
      formatStyleDetail({
        kind: 'guitarInfo',
        tick: 0,
        channel: 11,
        part: 'guitar',
        capo: 2,
        stringNotes: [64, 59, 55, 50, 45, 40],
      }),
    ).toBe('ギター, 1弦 CH 11, カポ位置 2, 各弦のノート番号: 64, 59, 55, 50, 45, 40');
  });

  test('formats all-channel bass info', () => {
    expect(
      formatStyleDetail({
        kind: 'guitarInfo',
        tick: 0,
        channel: null,
        part: 'bass',
        capo: 0,
        stringNotes: [43, 38, 33, 28],
      }),
    ).toBe('ベース, 全CH共通, カポ位置 0, 各弦のノート番号: 43, 38, 33, 28');
  });

  test('formats guitar voicing frets, open and muted strings', () => {
    expect(
      formatStyleDetail({
        kind: 'guitarVoicing',
        tick: 0,
        channel: 11,
        strings: [
          { fret: 3, finger: 2 },
          { fret: 0, finger: 0 },
          { fret: 127, finger: 0 },
        ],
      }),
    ).toBe('CH 11, 1弦 3フレット 指番号 2 / 2弦 開放弦 / 3弦 弾かない弦');
  });

  test('formats all-channel voicing with a pressed string without finger', () => {
    expect(
      formatStyleDetail({
        kind: 'guitarVoicing',
        tick: 0,
        channel: null,
        strings: [{ fret: 5, finger: 0 }],
      }),
    ).toBe('全CH共通, 1弦 5フレット');
  });
});
