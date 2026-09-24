import { describe, expect, test } from 'bun:test';
import { buildKaraokePages, resolveKaraokeDisplay } from './karaokePages.ts';
import type { KaraokePage } from './karaokePages.ts';
import type { ParsedKaraoke, LyricLine, LyricSyllable } from './lyrics.ts';

function line(tick: number, endTick: number | null): LyricLine {
  return { tick, endTick, syllables: [], closedBy: null };
}

function parsed(opts: {
  lines: LyricLine[];
  pages: { tick: number; endTick: number | null; lines: LyricLine[] }[];
}): ParsedKaraoke {
  return {
    header: null,
    tokens: [],
    syllables: [],
    lines: opts.lines,
    pages: opts.pages,
  };
}

describe('buildKaraokePages', () => {
  test('returns empty when no lines', () => {
    expect(buildKaraokePages(parsed({ lines: [], pages: [] }))).toEqual([]);
  });

  test('maps existing multi-page parsed data as-is', () => {
    const l1 = line(10, 50);
    const l2 = line(50, 90);
    const l3 = line(100, null);
    const result = buildKaraokePages(
      parsed({
        lines: [l1, l2, l3],
        pages: [
          { tick: 10, endTick: 90, lines: [l1, l2] },
          { tick: 100, endTick: null, lines: [l3] },
        ],
      }),
    );
    expect(result).toEqual([
      { startTick: 10, displayTick: 10, endTick: 100, lines: [l1, l2] },
      { startTick: 100, displayTick: 100, endTick: null, lines: [l3] },
    ]);
  });

  test('falls back to 4-line chunking when only one page', () => {
    const lines = [
      line(10, 20),
      line(20, 30),
      line(30, 40),
      line(40, 50),
      line(50, 60),
      line(60, null),
    ];
    const result = buildKaraokePages(
      parsed({
        lines,
        pages: [{ tick: 10, endTick: null, lines }],
      }),
    );
    expect(result).toEqual([
      {
        startTick: 10,
        displayTick: 10,
        endTick: 50,
        lines: [lines[0]!, lines[1]!, lines[2]!, lines[3]!],
      },
      { startTick: 50, displayTick: 50, endTick: null, lines: [lines[4]!, lines[5]!] },
    ]);
  });

  test('falls back to 4-line chunking when no page breaks', () => {
    const lines = [line(0, 10), line(10, 20), line(20, null)];
    const result = buildKaraokePages(parsed({ lines, pages: [] }));
    expect(result).toEqual([{ startTick: 0, displayTick: 0, endTick: null, lines }]);
  });
});

function syl(tick: number, endTick: number | null): LyricSyllable {
  return { tick, endTick, runs: [], vocalPart: null };
}

function sungLine(...syllables: LyricSyllable[]): LyricLine {
  return { tick: syllables[0]!.tick, endTick: null, syllables, closedBy: null };
}

describe('buildKaraokePages display tick', () => {
  test('shows the next page when the last syllable of the previous page ends', () => {
    const a1 = sungLine(syl(0, 100));
    const b1 = sungLine(syl(100, 200), syl(200, 300));
    const a2 = sungLine(syl(1000, null));
    const result = buildKaraokePages(
      parsed({
        lines: [a1, b1, a2],
        pages: [
          { tick: 0, endTick: 1000, lines: [a1, b1] },
          { tick: 1000, endTick: null, lines: [a2] },
        ],
      }),
    );
    expect(result.map((p) => p.displayTick)).toEqual([0, 300]);
  });

  test('keeps the start tick when the previous page has no syllable end', () => {
    const a1 = sungLine(syl(0, null));
    const a2 = sungLine(syl(1000, null));
    const result = buildKaraokePages(
      parsed({
        lines: [a1, a2],
        pages: [
          { tick: 0, endTick: 1000, lines: [a1] },
          { tick: 1000, endTick: null, lines: [a2] },
        ],
      }),
    );
    expect(result.map((p) => p.displayTick)).toEqual([0, 1000]);
  });
});

describe('resolveKaraokeDisplay', () => {
  const page = (displayTick: number, lines: LyricLine[]): KaraokePage => ({
    startTick: lines[0]!.tick,
    displayTick,
    endTick: null,
    lines,
  });
  const pages = [
    page(0, [sungLine(syl(0, 100)), sungLine(syl(100, 200)), sungLine(syl(200, 300))]),
    page(300, [sungLine(syl(1000, 1100)), sungLine(syl(1100, 1200)), sungLine(syl(1200, null))]),
  ];

  test('follows the active line without preview', () => {
    expect(resolveKaraokeDisplay(pages, 150, 150)).toEqual({
      pageIdx: 0,
      lineIdx: 1,
      preview: false,
    });
  });

  test('previews the next page while the last line is sung and the lookahead reaches it', () => {
    expect(resolveKaraokeDisplay(pages, 250, 300)).toEqual({
      pageIdx: 0,
      lineIdx: 2,
      preview: true,
    });
  });

  test('does not preview before the lookahead reaches the next page', () => {
    expect(resolveKaraokeDisplay(pages, 250, 299).preview).toBe(false);
  });

  test('waits for the last line to start before previewing', () => {
    expect(resolveKaraokeDisplay(pages, 150, 400)).toEqual({
      pageIdx: 0,
      lineIdx: 1,
      preview: false,
    });
  });

  test('switches to the next page at its display tick before its first line starts', () => {
    expect(resolveKaraokeDisplay(pages, 300, 400)).toEqual({
      pageIdx: 1,
      lineIdx: 0,
      preview: false,
    });
  });

  test('never previews on the last page', () => {
    expect(resolveKaraokeDisplay(pages, 1250, 5000).preview).toBe(false);
  });

  test('does not preview a single-line page before its line starts', () => {
    const single = [
      page(0, [sungLine(syl(0, 100))]),
      page(100, [sungLine(syl(500, 600))]),
      page(600, [sungLine(syl(1000, 1100)), sungLine(syl(1100, null))]),
    ];
    expect(resolveKaraokeDisplay(single, 200, 700).preview).toBe(false);
    expect(resolveKaraokeDisplay(single, 500, 700)).toEqual({
      pageIdx: 1,
      lineIdx: 0,
      preview: true,
    });
  });
});
