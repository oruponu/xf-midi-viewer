import { describe, expect, test } from 'bun:test';
import { parseKaraoke } from './lyrics.ts';
import type { KaraokeEvent, XfKaraokeData } from './types.ts';

function karaoke(events: KaraokeEvent[]): XfKaraokeData {
  return { header: null, events };
}

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
