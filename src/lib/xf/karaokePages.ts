import { computeKaraokeSectionBreaks } from './lyricSections.ts';
import type { LyricLine, LyricToken, ParsedKaraoke } from './lyrics.ts';
import type { RehearsalMessage } from './types.ts';

export interface KaraokePage {
  startTick: number;
  displayTick: number;
  endTick: number | null;
  sectionStart: boolean;
  lines: LyricLine[];
}

export interface KaraokeDisplay {
  pageIdx: number;
  lineIdx: number;
  preview: boolean;
  hidden: boolean;
}

const FALLBACK_LINES_PER_PAGE = 4;

export function buildKaraokePages(
  parsed: ParsedKaraoke,
  rehearsals: readonly RehearsalMessage[] = [],
): KaraokePage[] {
  if (parsed.lines.length === 0) return [];

  const pages: Omit<KaraokePage, 'displayTick' | 'sectionStart'>[] = [];
  if (parsed.pages.length >= 2) {
    parsed.pages.forEach((page, i) => {
      pages.push({
        startTick: page.tick,
        endTick: parsed.pages[i + 1]?.tick ?? null,
        lines: page.lines,
      });
    });
  } else {
    for (let i = 0; i < parsed.lines.length; i += FALLBACK_LINES_PER_PAGE) {
      const chunk = parsed.lines.slice(i, i + FALLBACK_LINES_PER_PAGE);
      pages.push({
        startTick: chunk[0]!.tick,
        endTick: parsed.lines[i + FALLBACK_LINES_PER_PAGE]?.tick ?? null,
        lines: chunk,
      });
    }
  }

  const sectionStarts = sectionStartSyllables(parsed.tokens, rehearsals);
  let syllableIdx = 0;
  return pages.map((page, i) => {
    const sectionStart = sectionStarts.has(syllableIdx);
    syllableIdx += page.lines.reduce((sum, line) => sum + line.syllables.length, 0);
    return {
      ...page,
      displayTick: displayTickAfter(pages[i - 1]?.lines ?? [], page),
      sectionStart,
    };
  });
}

function displayTickAfter(
  prevLines: readonly LyricLine[],
  page: Pick<KaraokePage, 'startTick' | 'lines'>,
): number {
  const { startTick } = page;
  if (isNonLyricPage(page)) return startTick;
  const wipeEnd = prevLines.at(-1)?.syllables.at(-1)?.endTick ?? null;
  return wipeEnd === null ? startTick : Math.min(wipeEnd, startTick);
}

function sectionStartSyllables(
  tokens: readonly LyricToken[],
  rehearsals: readonly RehearsalMessage[],
): Set<number> {
  const { replaceWithDivider, dividerBefore } = computeKaraokeSectionBreaks(tokens, rehearsals);
  const starts = new Set<number>();
  let syllableIdx = 0;
  tokens.forEach((token, i) => {
    if (replaceWithDivider.has(i) || dividerBefore.has(i)) starts.add(syllableIdx);
    if (token.kind === 'syllable') syllableIdx += 1;
  });
  return starts;
}

export function resolveKaraokeDisplay(
  pages: KaraokePage[],
  tick: number,
  lookaheadTick: number,
): KaraokeDisplay {
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pages[mid]!.displayTick <= tick) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) {
    const first = pages[0]!;
    const revealTick = isNonLyricPage(first) ? tick : lookaheadTick;
    if (first.displayTick > revealTick) {
      return { pageIdx: 0, lineIdx: 0, preview: false, hidden: true };
    }
  }
  const pageIdx = Math.max(0, lo - 1);
  const page = pages[pageIdx]!;
  const lineIdx = findActiveLineIndex(page.lines, tick);

  const next = pages[pageIdx + 1];
  const lastLine = page.lines.at(-1);
  const preview =
    next !== undefined &&
    lastLine !== undefined &&
    lineIdx === page.lines.length - 1 &&
    lastLine.tick <= tick &&
    next.displayTick <= lookaheadTick;

  if (preview && isNonLyricPage(page)) {
    return { pageIdx: pageIdx + 1, lineIdx: 0, preview: false, hidden: false };
  }
  return { pageIdx, lineIdx, preview, hidden: false };
}

export type LineAlignment = 'left' | 'right' | 'center';

export function lineAlignment(index: number, lineCount: number): LineAlignment {
  if (lineCount % 2 === 1 && index === lineCount - 1) return 'center';
  return index % 2 === 0 ? 'left' : 'right';
}

export interface KaraokeRow {
  lineIndices: [number] | [number, number];
  alignment: LineAlignment;
}

export function chooseMergedPairs(
  lineWidths: readonly number[],
  gapWidth: number,
  availableWidth: number,
): boolean[] {
  const candidates = lineWidths
    .slice(0, -1)
    .map((width, i) => ({ index: i, width: width + gapWidth + lineWidths[i + 1]! }))
    .filter((pair) => pair.width <= availableWidth)
    .sort((a, b) => a.width - b.width || a.index - b.index);

  const merged = lineWidths.map(() => false);
  const used = new Set<number>();
  for (const { index } of candidates) {
    if (used.has(index) || used.has(index + 1)) continue;
    merged[index] = true;
    used.add(index);
    used.add(index + 1);
  }
  return merged;
}

export function buildKaraokeRows(merged: readonly boolean[]): KaraokeRow[] {
  const groups: KaraokeRow['lineIndices'][] = [];
  for (let i = 0; i < merged.length; i += 1) {
    if (merged[i] && i + 1 < merged.length) {
      groups.push([i, i + 1]);
      i += 1;
    } else {
      groups.push([i]);
    }
  }
  return groups.map((lineIndices, i) => ({
    lineIndices,
    alignment: lineAlignment(i, groups.length),
  }));
}

export function mergeSingleRowPages(
  pages: readonly KaraokePage[],
  pairs: readonly (readonly boolean[])[],
): { pages: KaraokePage[]; pairs: boolean[][] } {
  const pagePairs = pages.map((page, i) => pairs[i] ?? page.lines.map(() => false));
  const canJoin = (i: number) => {
    const page = pages[i];
    return page !== undefined && !isNonLyricPage(page);
  };
  const joinsPrev = pages.map(() => false);
  pages.forEach((page, i) => {
    if (buildKaraokeRows(pagePairs[i]!).length !== 1 || !canJoin(i)) return;
    if (canJoin(i - 1) && !page.sectionStart) joinsPrev[i] = true;
    else if (canJoin(i + 1) && !pages[i + 1]!.sectionStart) joinsPrev[i + 1] = true;
    else if (canJoin(i - 1)) joinsPrev[i] = true;
    else if (canJoin(i + 1)) joinsPrev[i + 1] = true;
  });

  const mergedPages: KaraokePage[] = [];
  const mergedPairs: boolean[][] = [];
  pages.forEach((page, i) => {
    const prev = mergedPages.at(-1);
    if (joinsPrev[i] && prev !== undefined) {
      mergedPages[mergedPages.length - 1] = {
        ...prev,
        endTick: page.endTick,
        lines: [...prev.lines, ...page.lines],
      };
      mergedPairs[mergedPairs.length - 1] = [...mergedPairs.at(-1)!, ...pagePairs[i]!];
      return;
    }
    mergedPages.push(page);
    mergedPairs.push([...pagePairs[i]!]);
  });
  return { pages: mergedPages, pairs: mergedPairs };
}

const MAX_ROWS_PER_PAGE = 3;

export function splitLongPages(
  pages: readonly KaraokePage[],
  pairs: readonly (readonly boolean[])[],
): { pages: KaraokePage[]; pairs: boolean[][] } {
  const splitPages: KaraokePage[] = [];
  const splitPairs: boolean[][] = [];
  pages.forEach((page, i) => {
    const pagePairs = pairs[i] ?? page.lines.map(() => false);
    const rows = buildKaraokeRows(pagePairs);
    if (rows.length <= MAX_ROWS_PER_PAGE) {
      splitPages.push(page);
      splitPairs.push([...pagePairs]);
      return;
    }

    const pageCount = Math.ceil(rows.length / MAX_ROWS_PER_PAGE);
    const lineStarts: number[] = [];
    let rowIdx = 0;
    for (let p = 0; p < pageCount; p += 1) {
      lineStarts.push(rows[rowIdx]!.lineIndices[0]);
      rowIdx += Math.floor(rows.length / pageCount) + (p < rows.length % pageCount ? 1 : 0);
    }
    lineStarts.forEach((start, p) => {
      const end = lineStarts[p + 1] ?? page.lines.length;
      const lines = page.lines.slice(start, end);
      const next = page.lines[end];
      splitPages.push(
        p === 0
          ? { ...page, endTick: next!.tick, lines }
          : {
              startTick: lines[0]!.tick,
              displayTick: displayTickAfter(page.lines.slice(0, start), {
                startTick: lines[0]!.tick,
                lines,
              }),
              endTick: next?.tick ?? page.endTick,
              sectionStart: false,
              lines,
            },
      );
      splitPairs.push(pagePairs.slice(start, end));
    });
  });
  return { pages: splitPages, pairs: splitPairs };
}

function isNonLyricPage(page: Pick<KaraokePage, 'lines'>): boolean {
  return page.lines.every((line) => line.syllables.every((syl) => syl.vocalPart === 'nonLyric'));
}

function findActiveLineIndex(lines: LyricLine[], tick: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid]!.tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
