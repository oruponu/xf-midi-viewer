export type LyricPart =
  | { kind: 'text'; text: string }
  | { kind: 'ruby'; base: string; reading: string }
  | { kind: 'newline' };

export interface LyricInput {
  tick: number;
  text: string;
}

export interface ParsedLyric {
  tick: number;
  parts: LyricPart[];
}

type ParserState =
  | { mode: 'normal' }
  | {
      mode: 'paren';
      openParts: LyricPart[];
      baseChar: string;
      reading: string;
    }
  | {
      mode: 'bracket';
      openParts: LyricPart[];
      base: string;
      reading: string;
    };

export function parseLyricStream(items: LyricInput[]): ParsedLyric[] {
  const out: ParsedLyric[] = [];
  let state: ParserState = { mode: 'normal' };

  for (const { tick, text } of items) {
    const parsed: ParsedLyric = { tick, parts: [] };
    out.push(parsed);

    let buffer = '';
    let i = 0;

    const flushBuffer = (): void => {
      if (buffer.length > 0) {
        parsed.parts.push({ kind: 'text', text: buffer });
        buffer = '';
      }
    };

    while (i < text.length) {
      if (state.mode === 'paren') {
        const close = text.indexOf(')', i);
        if (close === -1) {
          state.reading += text.slice(i);
          i = text.length;
          break;
        }
        const reading = state.reading + text.slice(i, close);
        state.openParts.push({
          kind: 'ruby',
          base: state.baseChar,
          reading,
        });
        state = { mode: 'normal' };
        i = close + 1;
        continue;
      }

      if (state.mode === 'bracket') {
        const close = text.indexOf(']', i);
        if (close === -1) {
          state.reading += text.slice(i);
          i = text.length;
          break;
        }
        const reading = state.reading + text.slice(i, close);
        state.openParts.push({
          kind: 'ruby',
          base: state.base,
          reading,
        });
        state = { mode: 'normal' };
        i = close + 1;
        continue;
      }

      const ch = text[i]!;

      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1]!;
        if (next === 'r' || next === 'n') {
          flushBuffer();
          parsed.parts.push({ kind: 'newline' });
          i += 2;
          continue;
        }
        buffer += next;
        i += 2;
        continue;
      }

      if (ch === '/' || ch === '<' || ch === '\r' || ch === '\n') {
        flushBuffer();
        parsed.parts.push({ kind: 'newline' });
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

      if (ch === '%') {
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
          parsed.parts.push({ kind: 'ruby', base: baseChar, reading });
          i = close + 1;
          continue;
        }
        if (close === -1 && buffer.length > 0) {
          const baseChar = buffer.slice(-1);
          buffer = buffer.slice(0, -1);
          flushBuffer();
          state = {
            mode: 'paren',
            openParts: parsed.parts,
            baseChar,
            reading: text.slice(i + 1),
          };
          i = text.length;
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
          parsed.parts.push({ kind: 'ruby', base: buffer, reading });
          buffer = '';
          i = close + 1;
          continue;
        }
        if (close === -1 && buffer.length > 0) {
          state = {
            mode: 'bracket',
            openParts: parsed.parts,
            base: buffer,
            reading: text.slice(i + 1),
          };
          buffer = '';
          i = text.length;
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
  }

  if (state.mode === 'paren') {
    appendText(state.openParts, state.baseChar + '(' + state.reading);
  } else if (state.mode === 'bracket') {
    appendText(state.openParts, state.base + '[' + state.reading);
  }

  return out;
}

function appendText(parts: LyricPart[], text: string): void {
  if (text.length === 0) return;
  const last = parts[parts.length - 1];
  if (last && last.kind === 'text') {
    last.text += text;
  } else {
    parts.push({ kind: 'text', text });
  }
}

export function parseLyricText(text: string): LyricPart[] {
  return parseLyricStream([{ tick: 0, text }])[0]?.parts ?? [];
}

export function normalizeLyricText(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      out += text[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '^') {
      out += ' ';
      i += 1;
      continue;
    }
    if (ch === '>') {
      out += '\t';
      i += 1;
      continue;
    }
    if (ch === '%') {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function splitLyricLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === 'r' || next === 'n') {
        lines.push(current);
        current = '';
        i += 2;
        continue;
      }
      current += next;
      i += 2;
      continue;
    }
    if (ch === '/' || ch === '<' || ch === '\r' || ch === '\n') {
      lines.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === '^') {
      current += ' ';
      i += 1;
      continue;
    }
    if (ch === '>') {
      current += '\t';
      i += 1;
      continue;
    }
    if (ch === '%') {
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  lines.push(current);
  return lines;
}
