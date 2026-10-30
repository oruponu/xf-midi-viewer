import { runTransaction } from '../db.ts';
import type { SongInfo } from './songInfo.ts';

export type SavedLibrarySource =
  { kind: 'folder'; handle: FileSystemDirectoryHandle } | { kind: 'stored'; name: string };

const SOURCE_KEY = 'source';

export async function loadLibrarySource(): Promise<SavedLibrarySource | null> {
  const value: unknown = await runTransaction('libraryMeta', 'readonly', (tx) =>
    tx.objectStore('libraryMeta').get(SOURCE_KEY),
  );
  return isLibrarySource(value) ? value : null;
}

export async function loadSongInfos(): Promise<SongInfo[]> {
  const values: unknown[] = await runTransaction('songInfo', 'readonly', (tx) =>
    tx.objectStore('songInfo').getAll(),
  );
  return values.filter(isSongInfo);
}

export async function replaceLibrary(source: SavedLibrarySource): Promise<void> {
  await runTransaction(['libraryMeta', 'songInfo', 'songData'], 'readwrite', (tx) => {
    tx.objectStore('songInfo').clear();
    tx.objectStore('songData').clear();
    return tx.objectStore('libraryMeta').put(source, SOURCE_KEY);
  });
}

export async function putSongInfo(info: SongInfo): Promise<void> {
  await runTransaction('songInfo', 'readwrite', (tx) => tx.objectStore('songInfo').put(info));
}

export async function deleteSongs(fileNames: readonly string[]): Promise<void> {
  if (fileNames.length === 0) return;
  await runTransaction(['songInfo', 'songData'], 'readwrite', (tx) => {
    let last: IDBRequest<undefined> | undefined;
    for (const name of fileNames) {
      tx.objectStore('songData').delete(name);
      last = tx.objectStore('songInfo').delete(name);
    }
    return last!;
  });
}

export async function clearSongInfos(): Promise<void> {
  await runTransaction('songInfo', 'readwrite', (tx) => tx.objectStore('songInfo').clear());
}

export async function putStoredSong(info: SongInfo, data: ArrayBuffer): Promise<void> {
  await runTransaction(['songInfo', 'songData'], 'readwrite', (tx) => {
    tx.objectStore('songData').put(data, info.fileName);
    return tx.objectStore('songInfo').put(info);
  });
}

export async function loadStoredSongData(fileName: string): Promise<ArrayBuffer | null> {
  const value: unknown = await runTransaction('songData', 'readonly', (tx) =>
    tx.objectStore('songData').get(fileName),
  );
  return value instanceof ArrayBuffer ? value : null;
}

function isLibrarySource(value: unknown): value is SavedLibrarySource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; handle?: unknown; name?: unknown };
  if (candidate.kind === 'stored') return typeof candidate.name === 'string';
  return (
    candidate.kind === 'folder' &&
    typeof FileSystemDirectoryHandle !== 'undefined' &&
    candidate.handle instanceof FileSystemDirectoryHandle
  );
}

function isSongInfo(value: unknown): value is SongInfo {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const optional = ['titleReading', 'performer', 'performerReading', 'vocalType', 'year'];
  return (
    typeof candidate.fileName === 'string' &&
    typeof candidate.title === 'string' &&
    optional.every((key) => candidate[key] === undefined || typeof candidate[key] === 'string')
  );
}
