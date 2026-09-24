import type { LyricLine, ParsedKaraoke } from './lyrics.ts';

export interface KaraokePage {
  startTick: number;
  displayTick: number;
  endTick: number | null;
  lines: LyricLine[];
}

export interface KaraokeDisplay {
  pageIdx: number;
  lineIdx: number;
  preview: boolean;
}

const FALLBACK_LINES_PER_PAGE = 4;

export function buildKaraokePages(parsed: ParsedKaraoke): KaraokePage[] {
  if (parsed.lines.length === 0) return [];

  const pages: Omit<KaraokePage, 'displayTick'>[] = [];
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

  return pages.map((page, i) => {
    const wipeEnd = pages[i - 1]?.lines.at(-1)?.syllables.at(-1)?.endTick ?? null;
    return {
      ...page,
      displayTick: wipeEnd === null ? page.startTick : Math.min(wipeEnd, page.startTick),
    };
  });
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

  return { pageIdx, lineIdx, preview };
}

export type LineAlignment = 'left' | 'right' | 'center';

export function lineAlignment(index: number, lineCount: number): LineAlignment {
  if (lineCount % 2 === 1 && index === lineCount - 1) return 'center';
  return index % 2 === 0 ? 'left' : 'right';
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
