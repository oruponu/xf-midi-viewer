import { describe, expect, test } from 'bun:test';
import {
  buildKaraokePages,
  buildKaraokeRows,
  chooseMergedPairs,
  lineAlignment,
  mergeSingleRowPages,
  resolveKaraokeDisplay,
  splitLongPages,
} from './karaokePages.ts';
import type { KaraokePage } from './karaokePages.ts';
import { parseKaraoke } from './lyrics.ts';
import type { ParsedKaraoke, LyricLine, LyricSyllable } from './lyrics.ts';
import type { RehearsalMessage } from './types.ts';

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
      { startTick: 10, displayTick: 10, endTick: 100, sectionStart: false, lines: [l1, l2] },
      { startTick: 100, displayTick: 100, endTick: null, sectionStart: false, lines: [l3] },
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
        sectionStart: false,
        lines: [lines[0]!, lines[1]!, lines[2]!, lines[3]!],
      },
      {
        startTick: 50,
        displayTick: 50,
        endTick: null,
        sectionStart: false,
        lines: [lines[4]!, lines[5]!],
      },
    ]);
  });

  test('falls back to 4-line chunking when no page breaks', () => {
    const lines = [line(0, 10), line(10, 20), line(20, null)];
    const result = buildKaraokePages(parsed({ lines, pages: [] }));
    expect(result).toEqual([
      { startTick: 0, displayTick: 0, endTick: null, sectionStart: false, lines },
    ]);
  });
});

describe('buildKaraokePages section start', () => {
  const lyric = (tick: number, text: string) => ({ kind: 'lyric' as const, tick, text });
  const rehearsal = (tick: number): RehearsalMessage => ({
    kind: 'rehearsal',
    tick,
    letter: 'A',
    variation: 0,
  });
  const karaoke = parseKaraoke({
    header: null,
    events: [
      lyric(0, 'a1/'),
      lyric(480, 'a2<'),
      lyric(960, 'b1/'),
      lyric(1440, 'b2<'),
      lyric(1920, 'c1'),
    ],
  });

  test('marks the page that follows a section break', () => {
    const result = buildKaraokePages(karaoke, [rehearsal(900)]);
    expect(result.map((p) => p.sectionStart)).toEqual([false, true, false]);
  });

  test('ignores a section break inside a page', () => {
    const result = buildKaraokePages(karaoke, [rehearsal(1000)]);
    expect(result.map((p) => p.sectionStart)).toEqual([false, false, false]);
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
    sectionStart: false,
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
      hidden: false,
    });
  });

  test('previews the next page while the last line is sung and the lookahead reaches it', () => {
    expect(resolveKaraokeDisplay(pages, 250, 300)).toEqual({
      pageIdx: 0,
      lineIdx: 2,
      preview: true,
      hidden: false,
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
      hidden: false,
    });
  });

  test('switches to the next page at its display tick before its first line starts', () => {
    expect(resolveKaraokeDisplay(pages, 300, 400)).toEqual({
      pageIdx: 1,
      lineIdx: 0,
      preview: false,
      hidden: false,
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
      hidden: false,
    });
  });

  test('switches from a non-lyric page to the next page when the preview would start', () => {
    const nonLyric = [
      page(0, [sungLine({ ...syl(0, 500), vocalPart: 'nonLyric' })]),
      page(1000, [sungLine(syl(1000, 1100)), sungLine(syl(1100, null))]),
    ];
    expect(resolveKaraokeDisplay(nonLyric, 500, 999).preview).toBe(false);
    expect(resolveKaraokeDisplay(nonLyric, 500, 1000)).toEqual({
      pageIdx: 1,
      lineIdx: 0,
      preview: false,
      hidden: false,
    });
  });

  test('hides a leading non-lyric page until it starts', () => {
    const nonLyric = [
      page(480, [sungLine({ ...syl(480, 500), vocalPart: 'nonLyric' })]),
      page(1000, [sungLine(syl(1000, 1100))]),
    ];
    expect(resolveKaraokeDisplay(nonLyric, 479, 479).hidden).toBe(true);
    expect(resolveKaraokeDisplay(nonLyric, 480, 480).hidden).toBe(false);
  });

  test('shows a leading lyric page once the lookahead reaches it', () => {
    const lyric = [page(480, [sungLine(syl(480, 500))])];
    expect(resolveKaraokeDisplay(lyric, 0, 479).hidden).toBe(true);
    expect(resolveKaraokeDisplay(lyric, 0, 480).hidden).toBe(false);
  });
});

describe('mergeSingleRowPages', () => {
  const page = (...lines: LyricLine[]): KaraokePage => ({
    startTick: lines[0]!.tick,
    displayTick: lines[0]!.tick,
    endTick: lines.at(-1)!.syllables.at(-1)!.endTick,
    sectionStart: false,
    lines,
  });
  const sectionPage = (...lines: LyricLine[]): KaraokePage => ({
    ...page(...lines),
    sectionStart: true,
  });
  const nonLyricLine = (tick: number, endTick: number): LyricLine => ({
    ...sungLine(syl(tick, endTick)),
    syllables: [{ ...syl(tick, endTick), vocalPart: 'nonLyric' }],
  });

  test('appends a single-row page to the previous page', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = page(sungLine(syl(300, 400)), sungLine(syl(400, 500)));
    const result = mergeSingleRowPages(
      [a, b],
      [
        [false, false],
        [true, false],
      ],
    );
    expect(result).toEqual({
      pages: [
        {
          startTick: a.startTick,
          displayTick: a.displayTick,
          endTick: b.endTick,
          sectionStart: false,
          lines: [...a.lines, ...b.lines],
        },
      ],
      pairs: [[false, false, true, false]],
    });
  });

  test('keeps pages with more than one row', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = page(sungLine(syl(300, 400)), sungLine(syl(400, 500)));
    const pairs = [
      [false, false],
      [false, false],
    ];
    expect(mergeSingleRowPages([a, b], pairs)).toEqual({ pages: [a, b], pairs });
  });

  test('keeps a single-row first page', () => {
    const a = page(sungLine(syl(0, 100)));
    expect(mergeSingleRowPages([a], [[false]])).toEqual({ pages: [a], pairs: [[false]] });
  });

  test('does not merge a non-lyric page', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = page(nonLyricLine(300, 400));
    const pairs = [[false, false], [false]];
    expect(mergeSingleRowPages([a, b], pairs)).toEqual({ pages: [a, b], pairs });
  });

  test('does not merge into a non-lyric page', () => {
    const a = page(nonLyricLine(0, 100), nonLyricLine(100, 200));
    const b = page(sungLine(syl(300, 400)));
    const pairs = [[false, false], [false]];
    expect(mergeSingleRowPages([a, b], pairs)).toEqual({ pages: [a, b], pairs });
  });

  test('merges a page mixing lyrics and non-lyric syllables', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const mixed = sungLine(syl(300, 400), { ...syl(400, 500), vocalPart: 'nonLyric' });
    const b = page(mixed);
    const result = mergeSingleRowPages([a, b], [[false, false], [false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([[...a.lines, mixed]]);
  });

  test('keeps merging consecutive single-row pages into the same page', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = page(sungLine(syl(300, 400)));
    const c = page(sungLine(syl(500, 600)));
    const d = page(sungLine(syl(700, 800)), sungLine(syl(800, 900)));
    const result = mergeSingleRowPages(
      [a, b, c, d],
      [[false, false], [false], [false], [false, false]],
    );
    expect(result.pages.map((p) => p.lines)).toEqual([
      [...a.lines, ...b.lines, ...c.lines],
      d.lines,
    ]);
    expect(result.pages[0]!.endTick).toBe(c.endTick);
    expect(result.pairs).toEqual([
      [false, false, false, false],
      [false, false],
    ]);
  });

  test('prepends a single-row page that starts a section to the next page', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = sectionPage(sungLine(syl(300, 400)));
    const c = page(sungLine(syl(500, 600)), sungLine(syl(600, 700)));
    const result = mergeSingleRowPages([a, b, c], [[false, false], [false], [true, false]]);
    expect(result).toEqual({
      pages: [
        a,
        {
          startTick: b.startTick,
          displayTick: b.displayTick,
          endTick: c.endTick,
          sectionStart: true,
          lines: [...b.lines, ...c.lines],
        },
      ],
      pairs: [
        [false, false],
        [false, true, false],
      ],
    });
  });

  test('prepends a single-row first page to the next page', () => {
    const a = page(sungLine(syl(0, 100)));
    const b = page(sungLine(syl(300, 400)), sungLine(syl(400, 500)));
    const result = mergeSingleRowPages([a, b], [[false], [false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([[...a.lines, ...b.lines]]);
  });

  test('prepends a single-row page after a non-lyric page to the next page', () => {
    const a = page(nonLyricLine(0, 100));
    const b = page(sungLine(syl(300, 400)));
    const c = page(sungLine(syl(500, 600)), sungLine(syl(600, 700)));
    const result = mergeSingleRowPages([a, b, c], [[false], [false], [false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([a.lines, [...b.lines, ...c.lines]]);
  });

  test('prefers the previous page when both neighbors are in the same section', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = page(sungLine(syl(300, 400)));
    const c = page(sungLine(syl(500, 600)), sungLine(syl(600, 700)));
    const result = mergeSingleRowPages([a, b, c], [[false, false], [false], [false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([[...a.lines, ...b.lines], c.lines]);
  });

  test('merges across a section into the previous page when both neighbors are in other sections', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = sectionPage(sungLine(syl(300, 400)));
    const c = sectionPage(sungLine(syl(500, 600)), sungLine(syl(600, 700)));
    const result = mergeSingleRowPages([a, b, c], [[false, false], [false], [false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([[...a.lines, ...b.lines], c.lines]);
  });

  test('merges across a section into the next page when the previous page is unavailable', () => {
    const a = page(nonLyricLine(0, 100));
    const b = page(sungLine(syl(300, 400)));
    const c = sectionPage(sungLine(syl(500, 600)), sungLine(syl(600, 700)));
    const result = mergeSingleRowPages([a, b, c], [[false], [false], [false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([a.lines, [...b.lines, ...c.lines]]);
  });

  test('joins consecutive single-row pages that start a section', () => {
    const a = page(sungLine(syl(0, 100)), sungLine(syl(100, 200)));
    const b = sectionPage(sungLine(syl(300, 400)));
    const c = page(sungLine(syl(500, 600)));
    const d = page(sungLine(syl(700, 800)), sungLine(syl(800, 900)));
    const result = mergeSingleRowPages(
      [a, b, c, d],
      [[false, false], [false], [false], [false, false]],
    );
    expect(result.pages.map((p) => p.lines)).toEqual([a.lines, [...b.lines, ...c.lines], d.lines]);
  });
});

describe('splitLongPages', () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => sungLine(syl(i * 100, i * 100 + 50)));
  const page = (pageLines: LyricLine[], sectionStart = false): KaraokePage => ({
    startTick: pageLines[0]!.tick,
    displayTick: pageLines[0]!.tick,
    endTick: 1000,
    sectionStart,
    lines: pageLines,
  });
  const unpaired = (count: number) => Array.from({ length: count }, () => false);

  test('keeps pages with up to three rows', () => {
    const pages = [page(lines(3))];
    const pairs = [unpaired(3)];
    expect(splitLongPages(pages, pairs)).toEqual({ pages, pairs });
  });

  test('splits four rows into two pages of two rows', () => {
    const l = lines(4);
    expect(splitLongPages([page(l, true)], [unpaired(4)])).toEqual({
      pages: [
        { startTick: 0, displayTick: 0, endTick: 200, sectionStart: true, lines: [l[0]!, l[1]!] },
        {
          startTick: 200,
          displayTick: 150,
          endTick: 1000,
          sectionStart: false,
          lines: [l[2]!, l[3]!],
        },
      ],
      pairs: [unpaired(2), unpaired(2)],
    });
  });

  test('puts the pages with more rows first', () => {
    const rowCounts = (count: number) =>
      splitLongPages([page(lines(count))], [unpaired(count)]).pages.map((p) => p.lines.length);
    expect(rowCounts(5)).toEqual([3, 2]);
    expect(rowCounts(6)).toEqual([3, 3]);
    expect(rowCounts(7)).toEqual([3, 2, 2]);
  });

  test('counts rows after merging and keeps merged lines on the same page', () => {
    const l = lines(5);
    const result = splitLongPages([page(l)], [[true, false, false, false, false]]);
    expect(result.pages.map((p) => p.lines)).toEqual([
      [l[0]!, l[1]!, l[2]!],
      [l[3]!, l[4]!],
    ]);
    expect(result.pairs).toEqual([[true, false, false], unpaired(2)]);
  });

  test('splits only the long pages', () => {
    const short = page(lines(2));
    const long = page(lines(4));
    const result = splitLongPages([short, long], [unpaired(2), unpaired(4)]);
    expect(result.pages.map((p) => p.lines.length)).toEqual([2, 2, 2]);
    expect(result.pages[0]).toBe(short);
  });
});

describe('lineAlignment', () => {
  const layout = (count: number) =>
    Array.from({ length: count }, (_, i) => lineAlignment(i, count));

  test('centers a single line', () => {
    expect(layout(1)).toEqual(['center']);
  });

  test('alternates left and right on even line counts', () => {
    expect(layout(2)).toEqual(['left', 'right']);
    expect(layout(4)).toEqual(['left', 'right', 'left', 'right']);
  });

  test('centers the last line on odd line counts', () => {
    expect(layout(3)).toEqual(['left', 'right', 'center']);
    expect(layout(5)).toEqual(['left', 'right', 'left', 'right', 'center']);
  });
});

describe('chooseMergedPairs', () => {
  test('merges the narrowest adjacent pair first', () => {
    expect(chooseMergedPairs([100, 30, 30, 100], 5, 200)).toEqual([false, true, false, false]);
  });

  test('keeps merging remaining pairs that do not share a line', () => {
    expect(chooseMergedPairs([10, 10, 50, 50], 0, 100)).toEqual([true, false, true, false]);
  });

  test('prefers the upper pair on equal widths', () => {
    expect(chooseMergedPairs([30, 30, 30], 0, 100)).toEqual([true, false, false]);
  });

  test('skips pairs wider than the available width', () => {
    expect(chooseMergedPairs([60, 60], 5, 100)).toEqual([false, false]);
  });
});

describe('buildKaraokeRows', () => {
  test('keeps alternating lines when nothing is merged', () => {
    expect(buildKaraokeRows([false, false, false])).toEqual([
      { lineIndices: [0], alignment: 'left' },
      { lineIndices: [1], alignment: 'right' },
      { lineIndices: [2], alignment: 'center' },
    ]);
  });

  test('aligns rows by their position after merging', () => {
    expect(buildKaraokeRows([false, true, false, false])).toEqual([
      { lineIndices: [0], alignment: 'left' },
      { lineIndices: [1, 2], alignment: 'right' },
      { lineIndices: [3], alignment: 'center' },
    ]);
    expect(buildKaraokeRows([true, false, true, false])).toEqual([
      { lineIndices: [0, 1], alignment: 'left' },
      { lineIndices: [2, 3], alignment: 'right' },
    ]);
  });
});
