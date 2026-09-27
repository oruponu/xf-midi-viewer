import { NotSmfError, parseSmf } from './smf/parser.ts';
import { buildSong } from './song.ts';
import type { Song } from './song.ts';

export interface FileSummary {
  name: string;
  size: number;
  lastModified: number;
}

export interface SongSource extends FileSummary {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SongErrorReason = 'notSmf' | 'broken' | 'readFailed';

export type SongState =
  | { status: 'empty' }
  | { status: 'loading'; file: FileSummary }
  | { status: 'error'; file: FileSummary; reason: SongErrorReason; detail: string }
  | { status: 'loaded'; file: FileSummary; song: Song };

export interface SongLoader {
  load(source: SongSource): Promise<void>;
}

export function createSongLoader(onChange: (state: SongState) => void): SongLoader {
  let latest = 0;
  const load = async (source: SongSource): Promise<void> => {
    latest += 1;
    const token = latest;
    const file: FileSummary = {
      name: source.name,
      size: source.size,
      lastModified: source.lastModified,
    };
    onChange({ status: 'loading', file });
    const next = await readSong(source, file);
    if (token === latest) onChange(next);
  };
  return { load };
}

async function readSong(source: SongSource, file: FileSummary): Promise<SongState> {
  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
  } catch (error) {
    return { status: 'error', file, reason: 'readFailed', detail: errorMessage(error) };
  }
  try {
    return { status: 'loaded', file, song: buildSong(parseSmf(buffer)) };
  } catch (error) {
    const reason = error instanceof NotSmfError ? 'notSmf' : 'broken';
    return { status: 'error', file, reason, detail: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
