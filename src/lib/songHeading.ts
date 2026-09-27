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
      header?.songName !== undefined ? stripReading(header.songName) : stripExtension(fileName),
    performer: performer !== undefined ? stripReading(performer) : undefined,
  };
}

function stripReading(text: string): string {
  const paren = text.lastIndexOf('(');
  if (paren === -1) return text;
  const stripped = text.slice(0, paren).trimEnd();
  return stripped === '' ? text : stripped;
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
