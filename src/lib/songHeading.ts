import type { XfData } from './xf/types.ts';

export interface SongHeading {
  title: string;
  performer: string | undefined;
}

export function songHeading(xf: XfData, fileName: string): SongHeading {
  const header = xf.languageHeaders.find((h) => h.songName !== undefined);
  return {
    title: header?.songName ?? stripExtension(fileName),
    performer: header?.performer ?? xf.commonHeader?.performer,
  };
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
