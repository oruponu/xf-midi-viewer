import { describe, expect, test } from 'bun:test';
import { readSongInfo, songInfoFromXf } from './songInfo.ts';
import type { XfData, XfInfoHeaderCommon, XfInfoHeaderLanguageSpecific } from '../xf/types.ts';

const makeXf = (
  languageHeaders: Omit<XfInfoHeaderLanguageSpecific, 'kind'>[] = [],
  commonHeader: Omit<XfInfoHeaderCommon, 'kind'> | null = null,
): XfData => ({
  version: null,
  commonHeader: commonHeader && { kind: 'common', ...commonHeader },
  languageHeaders: languageHeaders.map((h) => ({ kind: 'languageSpecific', ...h })),
  karaoke: { header: null, events: [] },
  style: { events: [] },
});

function smfBytes(): ArrayBuffer {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4,
    0x00, 0xff, 0x2f, 0x00,
  ]).buffer;
}

function brokenBytes(): ArrayBuffer {
  return new Uint8Array([1, 2, 3]).buffer;
}

describe('songInfoFromXf', () => {
  test('takes the title, performer and their readings from the language header', () => {
    const xf = makeXf(
      [
        {
          language: 'JP',
          songName: '帰り道の歌(かえりみちのうた)',
          performer: '山田太郎(やまだたろう)',
        },
      ],
      { date: '2018/04/10', vocalType: 'm1', performer: 'Taro Yamada' },
    );

    expect(songInfoFromXf(xf, '帰り道の歌.mid')).toEqual({
      fileName: '帰り道の歌.mid',
      title: '帰り道の歌',
      titleReading: 'かえりみちのうた',
      performer: '山田太郎',
      performerReading: 'やまだたろう',
      vocalType: 'm1',
      year: '2018',
    });
  });

  test('falls back to the file name without XF info', () => {
    expect(songInfoFromXf(makeXf(), 'Etude.MID')).toEqual({
      fileName: 'Etude.MID',
      title: 'Etude',
    });
  });
});

describe('readSongInfo', () => {
  test('reads an SMF without XF info', () => {
    expect(readSongInfo(smfBytes(), 'a.mid')).toEqual({ fileName: 'a.mid', title: 'a' });
  });

  test('falls back to the file name for a broken file', () => {
    expect(readSongInfo(brokenBytes(), 'x.mid')).toEqual({ fileName: 'x.mid', title: 'x' });
  });
});
