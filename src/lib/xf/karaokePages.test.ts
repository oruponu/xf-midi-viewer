import { describe, expect, test } from 'bun:test';
import { buildKaraokePages } from './karaokePages.ts';
import type { ParsedKaraoke, LyricLine } from './lyrics.ts';

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
      { startTick: 10, endTick: 100, lines: [l1, l2] },
      { startTick: 100, endTick: null, lines: [l3] },
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
        endTick: 50,
        lines: [lines[0]!, lines[1]!, lines[2]!, lines[3]!],
      },
      { startTick: 50, endTick: null, lines: [lines[4]!, lines[5]!] },
    ]);
  });

  test('falls back to 4-line chunking when no page breaks', () => {
    const lines = [line(0, 10), line(10, 20), line(20, null)];
    const result = buildKaraokePages(parsed({ lines, pages: [] }));
    expect(result).toEqual([{ startTick: 0, endTick: null, lines }]);
  });
});
