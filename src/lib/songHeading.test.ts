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
    const xf = makeXf([{ language: 'JP', songName: 'ありがとう', performer: '山田太郎' }], {
      performer: 'Taro Yamada',
    });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'ありがとう', performer: '山田太郎' });
  });

  test('falls back to the common header performer', () => {
    const xf = makeXf([{ language: 'JP', songName: 'ありがとう' }], { performer: 'Taro Yamada' });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'ありがとう', performer: 'Taro Yamada' });
  });

  test('skips language headers without a song name', () => {
    const xf = makeXf([
      { language: 'JP', performer: '山田太郎' },
      { language: 'EN', songName: 'Hello', performer: 'Taro Yamada' },
    ]);

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'Hello', performer: 'Taro Yamada' });
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

  test('removes the reading from the song name and performer', () => {
    const xf = makeXf([
      {
        language: 'JP',
        songName: 'ありがとう(ありがとう)',
        performer: '山田太郎 (やまだたろう)',
      },
    ]);

    expect(songHeading(xf, 'song.mid')).toEqual({
      title: 'ありがとう',
      performer: '山田太郎',
    });
  });

  test('keeps full-width parentheses as part of the song name', () => {
    const plain = makeXf([{ language: 'JP', songName: 'ありがとう（ありがとう）' }]);
    const withReading = makeXf([
      { language: 'JP', songName: 'ありがとう（ありがとう）(ありがとう)' },
    ]);

    expect(songHeading(plain, 'song.mid').title).toBe('ありがとう（ありがとう）');
    expect(songHeading(withReading, 'song.mid').title).toBe('ありがとう（ありがとう）');
  });

  test('removes the text after the reading', () => {
    const xf = makeXf([{ language: 'JP', songName: 'ありがとう(ありがとう)（コード付）' }]);

    expect(songHeading(xf, 'song.mid').title).toBe('ありがとう');
  });

  test('removes a reading that is not written in hiragana', () => {
    const xf = makeXf([
      {
        language: 'JP',
        songName: 'Hello(Hello)/',
        performer: 'Taro Yamada(Taro Yamada)',
      },
    ]);

    expect(songHeading(xf, 'song.mid')).toEqual({
      title: 'Hello',
      performer: 'Taro Yamada',
    });
  });

  test('keeps a song name that is only a reading', () => {
    const xf = makeXf([{ language: 'JP', songName: '(ありがとう)' }]);

    expect(songHeading(xf, 'song.mid').title).toBe('(ありがとう)');
  });

  test('takes the common header performer when no song name is present', () => {
    const xf = makeXf([], { performer: 'Taro Yamada' });

    expect(songHeading(xf, 'song.mid')).toEqual({ title: 'song', performer: 'Taro Yamada' });
  });
});
