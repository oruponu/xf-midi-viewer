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

export interface LoadedSong {
  file: FileSummary;
  song: Song;
}

export interface LoadFailure {
  id: number;
  file: FileSummary;
  reason: SongErrorReason;
  detail: string;
}

export interface SongState {
  current: LoadedSong | null;
  pending: FileSummary | null;
  failure: LoadFailure | null;
}

export const INITIAL_SONG_STATE: SongState = { current: null, pending: null, failure: null };

export interface SongLoader {
  load(source: SongSource, beforeSwap?: () => void): Promise<void>;
}

type ReadResult = { ok: true; song: Song } | { ok: false; reason: SongErrorReason; detail: string };

export function createSongLoader(onChange: (state: SongState) => void): SongLoader {
  let state = INITIAL_SONG_STATE;
  let latest = 0;
  let failureCount = 0;
  const update = (next: SongState) => {
    state = next;
    onChange(next);
  };
  const load = async (source: SongSource, beforeSwap?: () => void): Promise<void> => {
    latest += 1;
    const token = latest;
    const file: FileSummary = {
      name: source.name,
      size: source.size,
      lastModified: source.lastModified,
    };
    update({ ...state, pending: file });
    const result = await readSong(source);
    if (token !== latest) return;
    if (result.ok) {
      beforeSwap?.();
      update({ current: { file, song: result.song }, pending: null, failure: null });
    } else {
      failureCount += 1;
      const failure = { id: failureCount, file, reason: result.reason, detail: result.detail };
      update({ current: state.current, pending: null, failure });
    }
  };
  return { load };
}

async function readSong(source: SongSource): Promise<ReadResult> {
  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
  } catch (error) {
    return { ok: false, reason: 'readFailed', detail: errorMessage(error) };
  }
  try {
    return { ok: true, song: buildSong(parseSmf(buffer)) };
  } catch (error) {
    const reason = error instanceof NotSmfError ? 'notSmf' : 'broken';
    return { ok: false, reason, detail: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
