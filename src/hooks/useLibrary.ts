import { useEffect, useMemo, useState } from 'react';
import {
  hasReadPermission,
  listMidiFileNames,
  pickFolder,
  readFolderFile,
  requestReadPermission,
  supportsFolderAccess,
} from '../lib/library/folderAccess.ts';
import { createLatestGate } from '../lib/library/latest.ts';
import { importSongs, scanFolder } from '../lib/library/libraryScan.ts';
import {
  clearSongInfos,
  deleteSongs,
  loadLibrarySource,
  loadSongInfos,
  loadStoredSongData,
  putSongInfo,
  putStoredSong,
  replaceLibrary,
} from '../lib/library/libraryStore.ts';
import type { SavedLibrarySource } from '../lib/library/libraryStore.ts';
import { topLevelMidiFiles } from '../lib/library/midiFiles.ts';
import type { SongInfo } from '../lib/library/songInfo.ts';
import { sortSongs } from '../lib/library/songSearch.ts';

export interface LibraryNotice {
  id: number;
  kind: 'readFailed' | 'quotaExceeded' | 'missing' | 'noSongs';
  fileNames: string[];
}

export interface LibraryState {
  status: 'loading' | 'empty' | 'ready';
  sourceKind: 'folder' | 'stored' | null;
  folderName: string | null;
  songs: SongInfo[];
  progress: { done: number; total: number } | null;
  notice: LibraryNotice | null;
}

export interface LibraryActions {
  chooseFolder(): void;
  importFolder(files: readonly File[], mode: 'replace' | 'add'): void;
  refresh(options?: { prompt: boolean }): void;
  rereadAll(): void;
  openSong(fileName: string): Promise<File | null>;
  dismissNotice(): void;
}

export interface Library extends LibraryState, LibraryActions {
  supportsFolderAccess: boolean;
}

const INITIAL_STATE: LibraryState = {
  status: 'loading',
  sourceKind: null,
  folderName: null,
  songs: [],
  progress: null,
  notice: null,
};

const UNNAMED_FOLDER = '選択した曲';

type OpenResult =
  { kind: 'file'; file: File } | { kind: 'denied' } | { kind: 'missing' } | { kind: 'failed' };

export function createLibraryController(onChange: (state: LibraryState) => void): {
  init(): Promise<void>;
  actions: LibraryActions;
} {
  let state = INITIAL_STATE;
  let source: SavedLibrarySource | null = null;
  // Bumped when the folder changes or is reread; work from an older generation is dropped.
  let generation = 0;
  let scan: Promise<void> | null = null;
  let scanned = false;
  let initialized = false;
  let persistRequested = false;
  let noticeCount = 0;
  let writes: Promise<unknown> = Promise.resolve();
  const gate = createLatestGate();

  const update = (patch: Partial<LibraryState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const showNotice = (kind: LibraryNotice['kind'], fileNames: string[]) => {
    noticeCount += 1;
    update({ notice: { id: noticeCount, kind, fileNames } });
  };
  const addSong = (info: SongInfo) =>
    update({
      songs: sortSongs([...state.songs.filter((s) => s.fileName !== info.fileName), info]),
    });
  const removeSongs = (fileNames: readonly string[]) => {
    const removed = new Set(fileNames);
    update({ songs: state.songs.filter((s) => !removed.has(s.fileName)) });
  };

  // Writes run one at a time so that clearing the library never overtakes an older write.
  const enqueue = <T>(write: () => Promise<T>): Promise<T> => {
    const next = writes.then(write);
    writes = next.catch(() => {});
    return next;
  };

  const replaceSource = async (next: SavedLibrarySource): Promise<number> => {
    generation += 1;
    const gen = generation;
    gate.invalidate();
    scan = null;
    scanned = false;
    source = next;
    update({
      status: 'ready',
      sourceKind: next.kind,
      folderName: next.kind === 'folder' ? next.handle.name : next.name,
      songs: [],
      progress: null,
      notice: null,
    });
    await enqueue(async () => {
      if (gen === generation) await replaceLibrary(next);
    });
    return gen;
  };

  const runScan = async (
    handle: FileSystemDirectoryHandle,
    gen: number,
    listed: string[] | undefined,
  ) => {
    const cancelled = () => gen !== generation;
    try {
      const names = listed ?? (await listMidiFileNames(handle));
      if (cancelled()) return;
      const known = new Set(state.songs.map((s) => s.fileName));
      const total = names.filter((name) => !known.has(name)).length;
      let done = 0;
      if (total > 0) update({ progress: { done, total } });
      const { failed } = await scanFolder({
        names,
        known,
        readFile: async (name) => (await readFolderFile(handle, name)).arrayBuffer(),
        onRemoved: async (removed) => {
          await enqueue(async () => {
            if (!cancelled()) await deleteSongs(removed);
          });
          if (!cancelled()) removeSongs(removed);
        },
        onAdded: async (info) => {
          await enqueue(async () => {
            if (!cancelled()) await putSongInfo(info);
          });
          if (cancelled()) return;
          done += 1;
          addSong(info);
          update({ progress: { done, total } });
        },
        isCancelled: cancelled,
      });
      if (cancelled()) return;
      scanned = true;
      update({ progress: null });
      if (failed.length > 0) showNotice('readFailed', failed);
    } catch (error) {
      if (cancelled()) return;
      update({ progress: null });
      console.error('Failed to read the song folder', error);
    }
  };

  const trackScan = (task: Promise<void>): Promise<void> => {
    const run: Promise<void> = task.finally(() => {
      if (scan === run) scan = null;
    });
    scan = run;
    return run;
  };

  const startScan = (): Promise<void> => {
    if (scan) return scan;
    if (source?.kind !== 'folder') return Promise.resolve();
    return trackScan(runScan(source.handle, generation, undefined));
  };

  const ensurePermission = async (handle: FileSystemDirectoryHandle, prompt: boolean) =>
    (await hasReadPermission(handle)) || (prompt && (await requestReadPermission(handle)));

  const readSong = async (current: SavedLibrarySource, fileName: string): Promise<OpenResult> => {
    if (current.kind === 'stored') {
      const data = await loadStoredSongData(fileName);
      return data ? { kind: 'file', file: new File([data], fileName) } : { kind: 'missing' };
    }
    if (!(await ensurePermission(current.handle, true))) return { kind: 'denied' };
    try {
      return { kind: 'file', file: await readFolderFile(current.handle, fileName) };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return { kind: 'missing' };
      }
      return { kind: 'failed' };
    }
  };

  const init = async () => {
    if (initialized) return;
    initialized = true;
    try {
      const [saved, infos] = await Promise.all([loadLibrarySource(), loadSongInfos()]);
      if (source !== null) return;
      if (saved === null) {
        update({ status: 'empty' });
        return;
      }
      source = saved;
      update({
        status: 'ready',
        sourceKind: saved.kind,
        folderName: saved.kind === 'folder' ? saved.handle.name : saved.name,
        songs: sortSongs(infos),
      });
      if (saved.kind === 'folder' && (await hasReadPermission(saved.handle))) void startScan();
    } catch (error) {
      if (source === null) update({ status: 'empty' });
      console.error('Failed to load the song library', error);
    }
  };

  const chooseFolder = async () => {
    const handle = await pickFolder();
    if (handle === null) return;
    const gen = await replaceSource({ kind: 'folder', handle });
    if (gen === generation) void startScan();
  };

  const importFolder = async (files: readonly File[], mode: 'replace' | 'add') => {
    const midiFiles = topLevelMidiFiles(files);
    if (midiFiles.length === 0) {
      showNotice('noSongs', []);
      return;
    }
    if (!persistRequested) {
      persistRequested = true;
      void navigator.storage?.persist?.().catch(() => {});
    }
    let gen = generation;
    if (mode === 'replace' || source?.kind !== 'stored') {
      const folder = midiFiles[0]!.webkitRelativePath?.split('/')[0];
      gen = await replaceSource({ kind: 'stored', name: folder || UNNAMED_FOLDER });
    }
    const cancelled = () => gen !== generation;
    if (cancelled()) return;
    const known = new Set(state.songs.map((s) => s.fileName));
    const total = new Set(midiFiles.map((f) => f.name).filter((name) => !known.has(name))).size;
    let done = 0;
    update({ progress: { done, total } });
    const result = await importSongs({
      files: midiFiles,
      known,
      save: (info, data) =>
        enqueue(async () => {
          if (!cancelled()) await putStoredSong(info, data);
        }),
      onAdded: (info) => {
        if (cancelled()) return;
        done += 1;
        addSong(info);
        update({ progress: { done, total } });
      },
      isCancelled: cancelled,
    });
    if (cancelled()) return;
    update({ progress: null });
    if (result.quotaExceeded) showNotice('quotaExceeded', []);
    else if (result.failed.length > 0) showNotice('readFailed', result.failed);
  };

  const refresh = async ({ prompt }: { prompt: boolean } = { prompt: true }) => {
    const current = source;
    if (current?.kind !== 'folder' || scan) return;
    if (!(await ensurePermission(current.handle, prompt))) return;
    if (current === source) void startScan();
  };

  const rereadAll = async () => {
    const current = source;
    if (current?.kind !== 'folder') return;
    if (!(await ensurePermission(current.handle, true))) return;
    const names = await listMidiFileNames(current.handle);
    if (current !== source) return;
    generation += 1;
    const gen = generation;
    const running = scan;
    // Registered as the running scan right away, so a refresh in the meantime does not start another scan
    await trackScan(
      (async () => {
        if (running) await running;
        await enqueue(async () => {
          if (gen === generation) await clearSongInfos();
        });
        if (gen !== generation) return;
        update({ songs: [], progress: null });
        await runScan(current.handle, gen, names);
      })(),
    );
  };

  const openSong = async (fileName: string): Promise<File | null> => {
    const current = source;
    if (current === null) return null;
    const gen = generation;
    let result: OpenResult | null;
    try {
      result = await gate.run(readSong(current, fileName));
    } catch {
      result = { kind: 'failed' };
    }
    if (result === null || gen !== generation) return null;
    switch (result.kind) {
      case 'file':
        if (current.kind === 'folder' && !scanned) void startScan();
        return result.file;
      case 'missing':
        await enqueue(async () => {
          if (gen === generation) await deleteSongs([fileName]);
        });
        if (gen !== generation) return null;
        removeSongs([fileName]);
        showNotice('missing', [fileName]);
        return null;
      case 'failed':
        showNotice('readFailed', [fileName]);
        return null;
      case 'denied':
        return null;
    }
  };

  const report = (task: Promise<unknown>) => {
    task.catch((error: unknown) => console.error('Song library operation failed', error));
  };

  return {
    init,
    actions: {
      chooseFolder: () => report(chooseFolder()),
      importFolder: (files, mode) => report(importFolder(files, mode)),
      refresh: (options) => report(refresh(options)),
      rereadAll: () => report(rereadAll()),
      openSong,
      dismissNotice: () => update({ notice: null }),
    },
  };
}

export function useLibrary(): Library {
  const [state, setState] = useState<LibraryState>(INITIAL_STATE);
  const [controller] = useState(() => createLibraryController(setState));
  useEffect(() => {
    void controller.init();
  }, [controller]);
  return useMemo(
    () => ({ ...state, ...controller.actions, supportsFolderAccess: supportsFolderAccess() }),
    [state, controller],
  );
}
