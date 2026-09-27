import { describe, expect, test } from 'bun:test';
import { songHeading } from './songHeading.ts';
import type { XfData, XfInfoHeaderCommon, XfInfoHeaderLanguageSpecific } from './xf/types.ts';

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

describe('songHeading', () => {
  test('takes the song name and performer from the language header', () => {
    const xf = makeXf([{ language: 'JP', songName: '夕焼けの歌', performer: '山田太郎' }], {
      performer: 'Taro Yamada',
    });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: '夕焼けの歌', performer: '山田太郎' });
  });

  test('falls back to the common header performer', () => {
    const xf = makeXf([{ language: 'JP', songName: '夕焼けの歌' }], { performer: 'Taro Yamada' });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: '夕焼けの歌', performer: 'Taro Yamada' });
  });

  test('skips language headers without a song name', () => {
    const xf = makeXf([
      { language: 'JP', performer: '山田太郎' },
      { language: 'EN', songName: 'Sunset Song', performer: 'Taro Yamada' },
    ]);

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'Sunset Song', performer: 'Taro Yamada' });
  });

  test('uses the file name without its extension when no song name is present', () => {
    expect(songHeading(makeXf(), 'my.song.mid')).toEqual({
      title: 'my.song',
      performer: undefined,
    });
  });

  test('keeps a file name that has no extension', () => {
    expect(songHeading(makeXf(), 'song').title).toBe('song');
    expect(songHeading(makeXf(), '.mid').title).toBe('.mid');
  });

  test('takes the common header performer when no song name is present', () => {
    const xf = makeXf([], { performer: 'Taro Yamada' });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'song', performer: 'Taro Yamada' });
  });
});
