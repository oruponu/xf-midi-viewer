import type { LyricLine, ParsedKaraoke } from './lyrics.ts';

export interface KaraokePage {
  startTick: number;
  endTick: number | null;
  lines: LyricLine[];
}

const FALLBACK_LINES_PER_PAGE = 4;

export function buildKaraokePages(parsed: ParsedKaraoke): KaraokePage[] {
  if (parsed.lines.length === 0) return [];

  if (parsed.pages.length >= 2) {
    return parsed.pages.map((page, i) => ({
      startTick: page.tick,
      endTick: parsed.pages[i + 1]?.tick ?? null,
      lines: page.lines,
    }));
  }

  const out: KaraokePage[] = [];
  for (let i = 0; i < parsed.lines.length; i += FALLBACK_LINES_PER_PAGE) {
    const chunk = parsed.lines.slice(i, i + FALLBACK_LINES_PER_PAGE);
    out.push({
      startTick: chunk[0]!.tick,
      endTick: parsed.lines[i + FALLBACK_LINES_PER_PAGE]?.tick ?? null,
      lines: chunk,
    });
  }
  return out;
}
