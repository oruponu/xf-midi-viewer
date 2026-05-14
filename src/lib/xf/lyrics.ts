import type { VocalPart, XfKaraokeData, XfLyricsHeader } from './types.ts';

export type LyricRun =
  | { kind: 'text'; text: string }
  | { kind: 'ruby'; base: string; reading: string };

export type LyricBreakSource = 'metaEvent' | 'controlChar';

export type LyricToken =
  | { kind: 'syllable'; tick: number; runs: LyricRun[] }
  | { kind: 'lineBreak'; tick: number; source: LyricBreakSource }
  | { kind: 'pageBreak'; tick: number; source: LyricBreakSource }
  | { kind: 'subBreak'; tick: number }
  | { kind: 'vocalPart'; tick: number; part: VocalPart };

export interface LyricSyllable {
  tick: number;
  endTick: number | null;
  runs: LyricRun[];
  vocalPart: VocalPart | null;
}

export interface LyricLine {
  tick: number;
  endTick: number | null;
  syllables: LyricSyllable[];
  closedBy: 'line' | 'page' | null;
}

export interface LyricPage {
  tick: number;
  endTick: number | null;
  lines: LyricLine[];
}

export interface ParsedKaraoke {
  header: XfLyricsHeader | null;
  tokens: LyricToken[];
  syllables: LyricSyllable[];
  lines: LyricLine[];
  pages: LyricPage[];
}

type SyllableToken = Extract<LyricToken, { kind: 'syllable' }>;

type RubyState =
  | {
      mode: 'paren';
      baseChar: string;
      reading: string;
      baseSyllable: SyllableToken;
    }
  | {
      mode: 'bracket';
      base: string;
      reading: string;
      baseSyllable: SyllableToken;
    };

export function parseKaraoke(data: XfKaraokeData): ParsedKaraoke {
  const tokens: LyricToken[] = [];
  let ruby: RubyState | null = null;

  for (const ev of data.events) {
    switch (ev.kind) {
      case 'carriageReturn':
        tokens.push({ kind: 'lineBreak', tick: ev.tick, source: 'metaEvent' });
        break;
      case 'lineFeed':
        tokens.push({ kind: 'pageBreak', tick: ev.tick, source: 'metaEvent' });
        break;
      case 'vocalPart':
        tokens.push({ kind: 'vocalPart', tick: ev.tick, part: ev.part });
        break;
      case 'lyric':
        ruby = tokenizeLyricEvent(ev.tick, ev.text, tokens, ruby);
        break;
    }
  }

  if (ruby !== null) {
    finalizeUnclosedRuby(ruby);
  }

  const syllables = buildSyllables(tokens);
  const lines = buildLines(tokens, syllables);
  const pages = buildPages(lines);

  return { header: data.header, tokens, syllables, lines, pages };
}

function tokenizeLyricEvent(
  tick: number,
  text: string,
  tokens: LyricToken[],
  ruby: RubyState | null,
): RubyState | null {
  let currentSyllable: SyllableToken | null = null;
  let buffer = '';

  const ensureSyllable = (): SyllableToken => {
    if (currentSyllable === null) {
      const sy: SyllableToken = { kind: 'syllable', tick, runs: [] };
      tokens.push(sy);
      currentSyllable = sy;
    }
    return currentSyllable;
  };

  const flushBuffer = (): void => {
    if (buffer.length > 0) {
      ensureSyllable().runs.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  const closeSyllable = (): void => {
    flushBuffer();
    currentSyllable = null;
  };

  let i = 0;

  if (ruby !== null) {
    const closeChar = ruby.mode === 'paren' ? ')' : ']';
    const close = text.indexOf(closeChar, i);
    if (close === -1) {
      ruby.reading += text;
      return ruby;
    }
    ruby.reading += text.slice(i, close);
    const rubyRun: LyricRun =
      ruby.mode === 'paren'
        ? { kind: 'ruby', base: ruby.baseChar, reading: ruby.reading }
        : { kind: 'ruby', base: ruby.base, reading: ruby.reading };
    ruby.baseSyllable.runs.push(rubyRun);
    ruby = null;
    i = close + 1;
  }

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === 'r') {
        closeSyllable();
        tokens.push({ kind: 'lineBreak', tick, source: 'controlChar' });
        i += 2;
        continue;
      }
      if (next === 'n') {
        closeSyllable();
        tokens.push({ kind: 'pageBreak', tick, source: 'controlChar' });
        i += 2;
        continue;
      }
      buffer += next;
      i += 2;
      continue;
    }

    if (ch === '/' || ch === '\r') {
      closeSyllable();
      tokens.push({ kind: 'lineBreak', tick, source: 'controlChar' });
      i += 1;
      continue;
    }

    if (ch === '<' || ch === '\n') {
      closeSyllable();
      tokens.push({ kind: 'pageBreak', tick, source: 'controlChar' });
      i += 1;
      continue;
    }

    if (ch === '%') {
      closeSyllable();
      tokens.push({ kind: 'subBreak', tick });
      i += 1;
      continue;
    }

    if (ch === '^') {
      buffer += ' ';
      i += 1;
      continue;
    }

    if (ch === '>') {
      buffer += '\t';
      i += 1;
      continue;
    }

    if (ch === '(') {
      const close = text.indexOf(')', i + 1);
      if (close !== -1 && close !== i + 1 && buffer.length > 0) {
        const reading = text.slice(i + 1, close);
        const baseChar = buffer.slice(-1);
        buffer = buffer.slice(0, -1);
        flushBuffer();
        ensureSyllable().runs.push({ kind: 'ruby', base: baseChar, reading });
        i = close + 1;
        continue;
      }
      if (close === -1 && buffer.length > 0) {
        const baseChar = buffer.slice(-1);
        buffer = buffer.slice(0, -1);
        flushBuffer();
        const baseSyllable = ensureSyllable();
        ruby = {
          mode: 'paren',
          baseChar,
          reading: text.slice(i + 1),
          baseSyllable,
        };
        break;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && close !== i + 1 && buffer.length > 0) {
        const reading = text.slice(i + 1, close);
        const base = buffer;
        buffer = '';
        ensureSyllable().runs.push({ kind: 'ruby', base, reading });
        i = close + 1;
        continue;
      }
      if (close === -1 && buffer.length > 0) {
        const base = buffer;
        buffer = '';
        const baseSyllable = ensureSyllable();
        ruby = {
          mode: 'bracket',
          base,
          reading: text.slice(i + 1),
          baseSyllable,
        };
        break;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flushBuffer();
  return ruby;
}

function finalizeUnclosedRuby(ruby: RubyState): void {
  const literal =
    ruby.mode === 'paren'
      ? ruby.baseChar + '(' + ruby.reading
      : ruby.base + '[' + ruby.reading;
  appendOrCreateText(ruby.baseSyllable.runs, literal);
}

function appendOrCreateText(runs: LyricRun[], text: string): void {
  if (text.length === 0) return;
  const last = runs[runs.length - 1];
  if (last && last.kind === 'text') {
    last.text += text;
  } else {
    runs.push({ kind: 'text', text });
  }
}

function buildSyllables(tokens: LyricToken[]): LyricSyllable[] {
  let activeVocalPart: VocalPart | null = null;
  const result: LyricSyllable[] = [];

  for (const tok of tokens) {
    if (tok.kind === 'vocalPart') {
      activeVocalPart = tok.part;
    } else if (tok.kind === 'syllable') {
      result.push({
        tick: tok.tick,
        endTick: null,
        runs: tok.runs,
        vocalPart: activeVocalPart,
      });
    }
  }

  for (let i = 0; i < result.length - 1; i += 1) {
    result[i]!.endTick = result[i + 1]!.tick;
  }

  return result;
}

function buildLines(
  tokens: LyricToken[],
  syllables: LyricSyllable[],
): LyricLine[] {
  const lines: LyricLine[] = [];
  let current: LyricSyllable[] = [];
  let startTick: number | null = null;
  let syllableIdx = 0;

  const closeLine = (
    closedBy: 'line' | 'page' | null,
    closerTick: number | null,
  ): void => {
    if (current.length === 0) return;
    lines.push({
      tick: startTick!,
      endTick: closerTick,
      syllables: current,
      closedBy,
    });
    current = [];
    startTick = null;
  };

  for (const tok of tokens) {
    if (tok.kind === 'syllable') {
      const syl = syllables[syllableIdx]!;
      syllableIdx += 1;
      if (startTick === null) startTick = syl.tick;
      current.push(syl);
    } else if (tok.kind === 'lineBreak') {
      closeLine('line', tok.tick);
    } else if (tok.kind === 'pageBreak') {
      if (current.length === 0 && lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        if (lastLine.closedBy === 'line') {
          lastLine.closedBy = 'page';
          lastLine.endTick = tok.tick;
        }
      } else {
        closeLine('page', tok.tick);
      }
    }
  }
  closeLine(null, null);

  return lines;
}

function buildPages(lines: LyricLine[]): LyricPage[] {
  const pages: LyricPage[] = [];
  let current: LyricLine[] = [];

  const closePage = (endTick: number | null): void => {
    if (current.length === 0) return;
    pages.push({
      tick: current[0]!.tick,
      endTick,
      lines: current,
    });
    current = [];
  };

  for (const line of lines) {
    current.push(line);
    if (line.closedBy === 'page') {
      closePage(line.endTick);
    }
  }
  closePage(null);

  return pages;
}
