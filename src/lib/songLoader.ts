import { parseSmf } from './smf/parser.ts';
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

export type SongState =
  | { status: 'empty' }
  | { status: 'loading'; file: FileSummary }
  | { status: 'error'; file: FileSummary; message: string }
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
    let next: SongState;
    try {
      next = { status: 'loaded', file, song: buildSong(parseSmf(await source.arrayBuffer())) };
    } catch (error) {
      next = {
        status: 'error',
        file,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (token === latest) onChange(next);
  };
  return { load };
}
