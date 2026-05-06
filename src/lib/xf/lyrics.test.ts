import { describe, expect, test } from 'bun:test';
import {
  normalizeLyricText,
  parseKaraoke,
  parseLyricStream,
  parseLyricText,
  splitLyricLines,
} from './lyrics.ts';
import type { KaraokeEvent, XfKaraokeData } from './types.ts';

function karaoke(events: KaraokeEvent[]): XfKaraokeData {
  return { header: null, events };
}

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

  test('less-than is treated as a page break', () => {
    expect(parseLyricText('まえ<つぎ')).toEqual([
      { kind: 'text', text: 'まえ' },
      { kind: 'newline' },
      { kind: 'text', text: 'つぎ' },
    ]);
  });

  test('escaped less-than is literal', () => {
    expect(parseLyricText('a\\<b')).toEqual([{ kind: 'text', text: 'a<b' }]);
  });

  test('greater-than is treated as a horizontal tab', () => {
    expect(parseLyricText('>やるせなさ')).toEqual([
      { kind: 'text', text: '\tやるせなさ' },
    ]);
  });

  test('escaped greater-than is literal', () => {
    expect(parseLyricText('a\\>b')).toEqual([{ kind: 'text', text: 'a>b' }]);
  });

  test('percent (sub-newline) is removed from output', () => {
    expect(parseLyricText('まえ%つぎ')).toEqual([
      { kind: 'text', text: 'まえつぎ' },
    ]);
  });

  test('escaped percent is literal', () => {
    expect(parseLyricText('a\\%b')).toEqual([{ kind: 'text', text: 'a%b' }]);
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

  test('greater-than is replaced with a tab', () => {
    expect(normalizeLyricText('>やるせなさ')).toBe('\tやるせなさ');
  });

  test('escaped greater-than is literal', () => {
    expect(normalizeLyricText('a\\>b')).toBe('a>b');
  });

  test('percent (sub-newline) is removed', () => {
    expect(normalizeLyricText('まえ%つぎ')).toBe('まえつぎ');
  });

  test('escaped percent is literal', () => {
    expect(normalizeLyricText('a\\%b')).toBe('a%b');
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

  test('splits on less-than as a page break', () => {
    expect(splitLyricLines('まえ<つぎ')).toEqual(['まえ', 'つぎ']);
  });

  test('escaped less-than is literal', () => {
    expect(splitLyricLines('a\\<b')).toEqual(['a<b']);
  });

  test('greater-than is replaced with a tab within each line', () => {
    expect(splitLyricLines('>やるせなさ/>つぎ')).toEqual([
      '\tやるせなさ',
      '\tつぎ',
    ]);
  });

  test('escaped greater-than is literal', () => {
    expect(splitLyricLines('a\\>b')).toEqual(['a>b']);
  });

  test('percent (sub-newline) is removed within each line', () => {
    expect(splitLyricLines('まえ%つぎ/さ%き')).toEqual(['まえつぎ', 'さき']);
  });

  test('escaped percent is literal', () => {
    expect(splitLyricLines('a\\%b')).toEqual(['a%b']);
  });
});

describe('parseKaraoke', () => {
  test('empty input', () => {
    const r = parseKaraoke(karaoke([]));
    expect(r).toEqual({
      header: null,
      tokens: [],
      syllables: [],
      lines: [],
      pages: [],
    });
  });

  test('passes header through', () => {
    const data: XfKaraokeData = {
      header: { melodyChannels: [4], displayOffset: 240, language: 'JP' },
      events: [],
    };
    expect(parseKaraoke(data).header).toEqual({
      melodyChannels: [4],
      displayOffset: 240,
      language: 'JP',
    });
  });

  test('single lyric event becomes one syllable token', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: 'hello' }]),
    );
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'hello' }] },
    ]);
  });

  test('endTick chains across syllables, last is null', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'lyric', tick: 20, text: 'b' },
        { kind: 'lyric', tick: 30, text: 'c' },
      ]),
    );
    expect(r.syllables.map((s) => [s.tick, s.endTick])).toEqual([
      [10, 20],
      [20, 30],
      [30, null],
    ]);
  });

  test('CR meta event becomes lineBreak with metaEvent source', () => {
    const r = parseKaraoke(karaoke([{ kind: 'carriageReturn', tick: 10 }]));
    expect(r.tokens).toEqual([
      { kind: 'lineBreak', tick: 10, source: 'metaEvent' },
    ]);
  });

  test('LF meta event becomes pageBreak with metaEvent source', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lineFeed', tick: 10 }]));
    expect(r.tokens).toEqual([
      { kind: 'pageBreak', tick: 10, source: 'metaEvent' },
    ]);
  });

  test('slash in text becomes lineBreak with controlChar source', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lyric', tick: 10, text: 'a/b' }]));
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
      { kind: 'lineBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  test('less-than in text becomes pageBreak with controlChar source', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lyric', tick: 10, text: '<a' }]));
    expect(r.tokens).toEqual([
      { kind: 'pageBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
    ]);
  });

  test('escaped backslash-r becomes lineBreak controlChar', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: 'a\\rb' }]),
    );
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
      { kind: 'lineBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  test('escaped backslash-n becomes pageBreak controlChar', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: 'a\\nb' }]),
    );
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
      { kind: 'pageBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  test('raw CR char becomes lineBreak, raw LF becomes pageBreak', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: 'a\rb\nc' }]),
    );
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
      { kind: 'lineBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'b' }] },
      { kind: 'pageBreak', tick: 10, source: 'controlChar' },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'c' }] },
    ]);
  });

  test('percent becomes subBreak token', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lyric', tick: 10, text: 'a%b' }]));
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a' }] },
      { kind: 'subBreak', tick: 10 },
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  test('caret becomes literal space inside text run', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lyric', tick: 10, text: 'a^b' }]));
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: 'a b' }] },
    ]);
  });

  test('greater-than becomes literal tab inside text run', () => {
    const r = parseKaraoke(karaoke([{ kind: 'lyric', tick: 10, text: '>a' }]));
    expect(r.tokens).toEqual([
      { kind: 'syllable', tick: 10, runs: [{ kind: 'text', text: '\ta' }] },
    ]);
  });

  test('paren ruby attaches to preceding char', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: '待(ま)てど' }]),
    );
    expect(r.tokens).toEqual([
      {
        kind: 'syllable',
        tick: 10,
        runs: [
          { kind: 'ruby', base: '待', reading: 'ま' },
          { kind: 'text', text: 'てど' },
        ],
      },
    ]);
  });

  test('bracket ruby attaches to whole preceding string', () => {
    const r = parseKaraoke(
      karaoke([{ kind: 'lyric', tick: 10, text: '元気[げんき]' }]),
    );
    expect(r.tokens).toEqual([
      {
        kind: 'syllable',
        tick: 10,
        runs: [{ kind: 'ruby', base: '元気', reading: 'げんき' }],
      },
    ]);
  });

  test('cross-event paren ruby is anchored to base event syllable', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: '亭(お' },
        { kind: 'lyric', tick: 20, text: 'とこ)' },
      ]),
    );
    expect(r.tokens).toEqual([
      {
        kind: 'syllable',
        tick: 10,
        runs: [{ kind: 'ruby', base: '亭', reading: 'おとこ' }],
      },
    ]);
  });

  test('unclosed paren ruby at end falls back to literal on base syllable', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: '主[と' },
        { kind: 'lyric', tick: 20, text: 'こ' },
      ]),
    );
    expect(r.tokens).toEqual([
      {
        kind: 'syllable',
        tick: 10,
        runs: [{ kind: 'text', text: '主[とこ' }],
      },
    ]);
  });

  test('vocalPart token preserved and stamped onto following syllables', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'vocalPart', tick: 5, part: 'female' },
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'lyric', tick: 20, text: 'b' },
        { kind: 'vocalPart', tick: 25, part: 'male' },
        { kind: 'lyric', tick: 30, text: 'c' },
      ]),
    );
    expect(r.syllables.map((s) => [s.tick, s.vocalPart])).toEqual([
      [10, 'female'],
      [20, 'female'],
      [30, 'male'],
    ]);
  });

  test('syllables before any vocalPart cue have null vocalPart', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'vocalPart', tick: 15, part: 'chorus' },
        { kind: 'lyric', tick: 20, text: 'b' },
      ]),
    );
    expect(r.syllables.map((s) => [s.tick, s.vocalPart])).toEqual([
      [10, null],
      [20, 'chorus'],
    ]);
  });

  test('lineBreak closes current line; lines exclude empty trailing', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'lyric', tick: 20, text: 'b' },
        { kind: 'carriageReturn', tick: 25 },
        { kind: 'lyric', tick: 30, text: 'c' },
      ]),
    );
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]!.syllables.map((s) => s.tick)).toEqual([10, 20]);
    expect(r.lines[0]!.closedBy).toBe('line');
    expect(r.lines[0]!.endTick).toBe(25);
    expect(r.lines[1]!.syllables.map((s) => s.tick)).toEqual([30]);
    expect(r.lines[1]!.closedBy).toBe(null);
    expect(r.lines[1]!.endTick).toBe(null);
  });

  test('pageBreak closes both line and page', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'lineFeed', tick: 15 },
        { kind: 'lyric', tick: 20, text: 'b' },
      ]),
    );
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.lines).toHaveLength(1);
    expect(r.pages[0]!.lines[0]!.closedBy).toBe('page');
    expect(r.pages[0]!.endTick).toBe(15);
    expect(r.pages[1]!.lines[0]!.syllables.map((s) => s.tick)).toEqual([20]);
  });

  test('multiple lines per page', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'carriageReturn', tick: 15 },
        { kind: 'lyric', tick: 20, text: 'b' },
        { kind: 'lineFeed', tick: 25 },
        { kind: 'lyric', tick: 30, text: 'c' },
      ]),
    );
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.lines.map((l) => l.closedBy)).toEqual(['line', 'page']);
    expect(r.pages[0]!.lines.map((l) => l.tick)).toEqual([10, 20]);
    expect(r.pages[1]!.lines).toHaveLength(1);
    expect(r.pages[1]!.lines[0]!.tick).toBe(30);
  });

  test('consecutive breaks do not produce empty lines or pages', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lineFeed', tick: 5 },
        { kind: 'carriageReturn', tick: 6 },
        { kind: 'lyric', tick: 10, text: 'a' },
        { kind: 'lineFeed', tick: 15 },
        { kind: 'lineFeed', tick: 16 },
        { kind: 'lyric', tick: 20, text: 'b' },
      ]),
    );
    expect(r.lines.map((l) => l.tick)).toEqual([10, 20]);
    expect(r.pages.map((p) => p.tick)).toEqual([10, 20]);
  });

  test('leading < page break with bracket ruby across events then trailing /', () => {
    const r = parseKaraoke(
      karaoke([
        { kind: 'lyric', tick: 1, text: '<宵[よ' },
        { kind: 'lyric', tick: 2, text: 'い]' },
        { kind: 'lyric', tick: 3, text: '待[ま' },
        { kind: 'lyric', tick: 4, text: 'ち]/' },
      ]),
    );
    expect(r.tokens).toEqual([
      { kind: 'pageBreak', tick: 1, source: 'controlChar' },
      {
        kind: 'syllable',
        tick: 1,
        runs: [{ kind: 'ruby', base: '宵', reading: 'よい' }],
      },
      {
        kind: 'syllable',
        tick: 3,
        runs: [{ kind: 'ruby', base: '待', reading: 'まち' }],
      },
      { kind: 'lineBreak', tick: 4, source: 'controlChar' },
    ]);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.lines).toHaveLength(1);
    expect(r.pages[0]!.lines[0]!.closedBy).toBe('line');
    expect(r.pages[0]!.lines[0]!.endTick).toBe(4);
    expect(r.pages[0]!.lines[0]!.syllables.map((s) => s.tick)).toEqual([1, 3]);
  });
});
