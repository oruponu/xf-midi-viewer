import { parseSmf } from '../smf/parser.ts';
import { songHeading, splitReading, stripExtension } from '../songHeading.ts';
import { extractXf } from '../xf/parser.ts';
import type { XfData } from '../xf/types.ts';

export interface SongInfo {
  fileName: string;
  title: string;
  titleReading?: string;
  performer?: string;
  performerReading?: string;
  vocalType?: string;
  year?: string;
}

export function songInfoFromXf(xf: XfData, fileName: string): SongInfo {
  const heading = songHeading(xf, fileName);
  const header = xf.languageHeaders.find((h) => h.songName !== undefined);
  const rawPerformer = header?.performer ?? xf.commonHeader?.performer;
  const info: SongInfo = { fileName, title: heading.title };
  const titleReading =
    header?.songName !== undefined ? splitReading(header.songName).reading : undefined;
  if (titleReading !== undefined) info.titleReading = titleReading;
  if (heading.performer !== undefined) info.performer = heading.performer;
  const performerReading =
    rawPerformer !== undefined ? splitReading(rawPerformer).reading : undefined;
  if (performerReading !== undefined) info.performerReading = performerReading;
  const vocalType = xf.commonHeader?.vocalType;
  if (vocalType !== undefined) info.vocalType = vocalType;
  const year = xf.commonHeader?.date?.match(/^\d{4}/)?.[0];
  if (year !== undefined) info.year = year;
  return info;
}

export function readSongInfo(buffer: ArrayBuffer, fileName: string): SongInfo {
  try {
    return songInfoFromXf(extractXf(parseSmf(buffer)), fileName);
  } catch {
    return { fileName, title: stripExtension(fileName) };
  }
}
