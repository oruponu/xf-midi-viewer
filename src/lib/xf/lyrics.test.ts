import { describe, expect, test } from 'bun:test';
import {
  normalizeLyricText,
  parseLyricStream,
  parseLyricText,
  splitLyricLines,
} from './lyrics.ts';

describe('parseLyricText', () => {
  test('plain text', () => {
    expect(parseLyricText('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  test('empty input', () => {
    expect(parseLyricText('')).toEqual([]);
  });

  test('paren yomigana attaches to single preceding char', () => {
    expect(parseLyricText('待(ま)てど')).toEqual([
      { kind: 'ruby', base: '待', reading: 'ま' },
      { kind: 'text', text: 'てど' },
    ]);
  });

  test('text before paren yomigana is kept', () => {
    expect(parseLyricText('xx待(ま)')).toEqual([
      { kind: 'text', text: 'xx' },
      { kind: 'ruby', base: '待', reading: 'ま' },
    ]);
  });

  test('bracket ruby attaches to whole preceding string', () => {
    expect(parseLyricText('他[ひ]')).toEqual([
      { kind: 'ruby', base: '他', reading: 'ひ' },
    ]);
  });

  test('multiple bracket ruby pairs', () => {
    expect(parseLyricText('元[げん]気[き]')).toEqual([
      { kind: 'ruby', base: '元', reading: 'げん' },
      { kind: 'ruby', base: '気', reading: 'き' },
    ]);
  });

  test('mixed plain and bracket ruby', () => {
    expect(parseLyricText('a元[げん]b')).toEqual([
      { kind: 'ruby', base: 'a元', reading: 'げん' },
      { kind: 'text', text: 'b' },
    ]);
  });

  test('unmatched open paren is rendered literally', () => {
    expect(parseLyricText('foo(')).toEqual([{ kind: 'text', text: 'foo(' }]);
  });

  test('paren without preceding base is rendered literally', () => {
    expect(parseLyricText('(orphan)')).toEqual([
      { kind: 'text', text: '(orphan)' },
    ]);
  });

  test('empty reading is rendered literally', () => {
    expect(parseLyricText('a()b')).toEqual([{ kind: 'text', text: 'a()b' }]);
  });

  test('backslash escapes paren', () => {
    expect(parseLyricText('a\\(b')).toEqual([{ kind: 'text', text: 'a(b' }]);
  });

  test('backslash escapes backslash', () => {
    expect(parseLyricText('a\\\\b')).toEqual([{ kind: 'text', text: 'a\\b' }]);
  });

  test('caret is treated as a space', () => {
    expect(parseLyricText('こよいは^月も')).toEqual([
      { kind: 'text', text: 'こよいは 月も' },
    ]);
  });

  test('caret as space does not break following ruby', () => {
    expect(parseLyricText('は^月(つき)')).toEqual([
      { kind: 'text', text: 'は ' },
      { kind: 'ruby', base: '月', reading: 'つき' },
    ]);
  });

  test('escaped caret is literal', () => {
    expect(parseLyricText('a\\^b')).toEqual([{ kind: 'text', text: 'a^b' }]);
  });

  test('slash is treated as a newline', () => {
    expect(parseLyricText('待てど/来ぬ')).toEqual([
      { kind: 'text', text: '待てど' },
      { kind: 'newline' },
      { kind: 'text', text: '来ぬ' },
    ]);
  });

  test('escaped slash is literal', () => {
    expect(parseLyricText('a\\/b')).toEqual([{ kind: 'text', text: 'a/b' }]);
  });

  test('CR and LF chars in text are treated as newlines', () => {
    expect(parseLyricText('a\rb\nc')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'newline' },
      { kind: 'text', text: 'b' },
      { kind: 'newline' },
      { kind: 'text', text: 'c' },
    ]);
  });

  test('backslash-r and backslash-n escape sequences are newlines', () => {
    expect(parseLyricText('a\\rb\\nc')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'newline' },
      { kind: 'text', text: 'b' },
      { kind: 'newline' },
      { kind: 'text', text: 'c' },
    ]);
  });

  test('newline inside ruby reading is part of text', () => {
    expect(parseLyricText('待(ま/た)')).toEqual([
      { kind: 'ruby', base: '待', reading: 'ま/た' },
    ]);
  });
});

describe('parseLyricStream', () => {
  test('single event passes through', () => {
    expect(parseLyricStream([{ tick: 10, text: 'hello' }])).toEqual([
      { tick: 10, parts: [{ kind: 'text', text: 'hello' }] },
    ]);
  });

  test('preserves tick per event', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: 'foo' },
        { tick: 20, text: 'bar' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'text', text: 'foo' }] },
      { tick: 20, parts: [{ kind: 'text', text: 'bar' }] },
    ]);
  });

  test('cross-event paren ruby anchors at base tick', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: '亭(お' },
        { tick: 20, text: 'とこ)' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'ruby', base: '亭', reading: 'おとこ' }] },
      { tick: 20, parts: [] },
    ]);
  });

  test('cross-event bracket ruby anchors at base tick', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: '主[と' },
        { tick: 20, text: 'こ]' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'ruby', base: '主', reading: 'とこ' }] },
      { tick: 20, parts: [] },
    ]);
  });

  test('reading split across three events', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: '亭(お' },
        { tick: 20, text: 'と' },
        { tick: 30, text: 'こ)' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'ruby', base: '亭', reading: 'おとこ' }] },
      { tick: 20, parts: [] },
      { tick: 30, parts: [] },
    ]);
  });

  test('text after closing bracket stays at close event', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: '主[と' },
        { tick: 20, text: 'こ]次' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'ruby', base: '主', reading: 'とこ' }] },
      { tick: 20, parts: [{ kind: 'text', text: '次' }] },
    ]);
  });

  test('spec example with mixed paren and bracket across events', () => {
    expect(
      parseLyricStream([
        { tick: 1, text: '他[ひ]' },
        { tick: 2, text: '人[と]' },
        { tick: 3, text: 'に' },
        { tick: 4, text: 'は' },
        { tick: 5, text: '見(み)' },
        { tick: 6, text: 'え' },
        { tick: 7, text: 'ぬ' },
        { tick: 8, text: '亭[お]' },
        { tick: 9, text: '主[と' },
        { tick: 10, text: 'こ]' },
      ]),
    ).toEqual([
      { tick: 1, parts: [{ kind: 'ruby', base: '他', reading: 'ひ' }] },
      { tick: 2, parts: [{ kind: 'ruby', base: '人', reading: 'と' }] },
      { tick: 3, parts: [{ kind: 'text', text: 'に' }] },
      { tick: 4, parts: [{ kind: 'text', text: 'は' }] },
      { tick: 5, parts: [{ kind: 'ruby', base: '見', reading: 'み' }] },
      { tick: 6, parts: [{ kind: 'text', text: 'え' }] },
      { tick: 7, parts: [{ kind: 'text', text: 'ぬ' }] },
      { tick: 8, parts: [{ kind: 'ruby', base: '亭', reading: 'お' }] },
      { tick: 9, parts: [{ kind: 'ruby', base: '主', reading: 'とこ' }] },
      { tick: 10, parts: [] },
    ]);
  });

  test('unclosed bracket across stream falls back to text on base event', () => {
    expect(
      parseLyricStream([
        { tick: 10, text: '主[と' },
        { tick: 20, text: 'こ' },
      ]),
    ).toEqual([
      { tick: 10, parts: [{ kind: 'text', text: '主[とこ' }] },
      { tick: 20, parts: [] },
    ]);
  });
});

describe('normalizeLyricText', () => {
  test('plain text is unchanged', () => {
    expect(normalizeLyricText('hello')).toBe('hello');
  });

  test('caret is replaced with space', () => {
    expect(normalizeLyricText('こよいは^月も')).toBe('こよいは 月も');
  });

  test('escaped caret is literal', () => {
    expect(normalizeLyricText('a\\^b')).toBe('a^b');
  });

  test('escaped backslash is literal', () => {
    expect(normalizeLyricText('a\\\\b')).toBe('a\\b');
  });

  test('preserves ruby brackets as text', () => {
    expect(normalizeLyricText('待(ま)月(つき)')).toBe('待(ま)月(つき)');
  });
});

describe('splitLyricLines', () => {
  test('plain text stays as single segment', () => {
    expect(splitLyricLines('hello')).toEqual(['hello']);
  });

  test('splits on slash', () => {
    expect(splitLyricLines('待てど/来ぬ')).toEqual(['待てど', '来ぬ']);
  });

  test('splits on raw CR and LF chars', () => {
    expect(splitLyricLines('a\rb\nc')).toEqual(['a', 'b', 'c']);
  });

  test('splits on backslash-r and backslash-n escape sequences', () => {
    expect(splitLyricLines('a\\rb\\nc')).toEqual(['a', 'b', 'c']);
  });

  test('escaped slash is literal', () => {
    expect(splitLyricLines('a\\/b')).toEqual(['a/b']);
  });

  test('escaped backslash is literal', () => {
    expect(splitLyricLines('a\\\\b')).toEqual(['a\\b']);
  });

  test('preserves ruby brackets as text', () => {
    expect(splitLyricLines('待(ま)/暮(く)')).toEqual(['待(ま)', '暮(く)']);
  });

  test('caret is replaced with space within each line', () => {
    expect(splitLyricLines('こよいは^月も/待(ま)てど')).toEqual([
      'こよいは 月も',
      '待(ま)てど',
    ]);
  });
});
