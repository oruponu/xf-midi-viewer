import type { XfData } from './xf/types.ts';

export interface SongHeading {
  title: string;
  performer: string | undefined;
}

export function songHeading(xf: XfData, fileName: string): SongHeading {
  const header = xf.languageHeaders.find((h) => h.songName !== undefined);
  const performer = header?.performer ?? xf.commonHeader?.performer;
  return {
    title:
      header?.songName !== undefined
        ? splitReading(header.songName).text
        : stripExtension(fileName),
    performer: performer !== undefined ? splitReading(performer).text : undefined,
  };
}

export function splitReading(text: string): { text: string; reading: string | undefined } {
  const paren = text.lastIndexOf('(');
  if (paren === -1) return { text, reading: undefined };
  const stripped = text.slice(0, paren).trimEnd();
  if (stripped === '') return { text, reading: undefined };
  const close = text.indexOf(')', paren);
  const reading = text.slice(paren + 1, close === -1 ? undefined : close).trim();
  return { text: stripped, reading: reading === '' ? undefined : reading };
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
