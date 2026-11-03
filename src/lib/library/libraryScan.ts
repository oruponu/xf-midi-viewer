import { readSongInfo } from './songInfo.ts';
import type { SongInfo } from './songInfo.ts';

export interface ScanFolderOptions {
  names: readonly string[];
  known: ReadonlySet<string>;
  readFile: (name: string) => Promise<ArrayBuffer>;
  onRemoved: (names: string[]) => Promise<void>;
  onAdded: (info: SongInfo) => Promise<void>;
  isCancelled: () => boolean;
}

export interface ImportSongsOptions {
  files: readonly File[];
  known: ReadonlySet<string>;
  save: (info: SongInfo, data: ArrayBuffer) => Promise<void>;
  onAdded: (info: SongInfo) => void;
  isCancelled: () => boolean;
}

export interface ImportResult {
  added: number;
  failed: string[];
  quotaExceeded: boolean;
}

export async function scanFolder(options: ScanFolderOptions): Promise<{ failed: string[] }> {
  const { names, known, readFile, onRemoved, onAdded, isCancelled } = options;
  const current = new Set(names);
  const removed = [...known].filter((name) => !current.has(name));
  if (removed.length > 0) await onRemoved(removed);
  const failed: string[] = [];
  // One at a time: each read of a cloud file can trigger a download.
  for (const name of names) {
    if (known.has(name)) continue;
    if (isCancelled()) break;
    let data: ArrayBuffer;
    try {
      data = await readFile(name);
    } catch {
      failed.push(name);
      continue;
    }
    if (isCancelled()) break;
    await onAdded(readSongInfo(data, name));
  }
  return { failed };
}

export async function importSongs(options: ImportSongsOptions): Promise<ImportResult> {
  const { files, known, save, onAdded, isCancelled } = options;
  const seen = new Set(known);
  const result: ImportResult = { added: 0, failed: [], quotaExceeded: false };
  for (const file of files) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    if (isCancelled()) break;
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch {
      result.failed.push(file.name);
      continue;
    }
    if (isCancelled()) break;
    const info = readSongInfo(data, file.name);
    try {
      await save(info, data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        result.quotaExceeded = true;
        break;
      }
      result.failed.push(file.name);
      continue;
    }
    result.added += 1;
    onAdded(info);
  }
  return result;
}
