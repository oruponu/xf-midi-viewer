import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SongInfo } from '../lib/library/songInfo.ts';

function smfFile(name: string): File {
  const bytes = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4,
    0x00, 0xff, 0x2f, 0x00,
  ]);
  return new File([bytes], name);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const handle = { name: 'Songs' } as FileSystemDirectoryHandle;
let folderNames: string[] = [];
let savedInfos: SongInfo[] = [];
let readGates: Map<string, ReturnType<typeof deferred>[]> = new Map();

const blockNextRead = (name: string) => {
  const gate = deferred();
  readGates.set(name, [...(readGates.get(name) ?? []), gate]);
  return gate;
};

mock.module('../lib/library/folderAccess.ts', () => ({
  supportsFolderAccess: () => true,
  pickFolder: async () => handle,
  hasReadPermission: async () => true,
  requestReadPermission: async () => true,
  listMidiFileNames: async () => [...folderNames],
  readFolderFile: async (_handle: FileSystemDirectoryHandle, name: string) => {
    const gate = readGates.get(name)?.shift();
    if (gate) await gate.promise;
    return smfFile(name);
  },
}));

mock.module('../lib/library/libraryStore.ts', () => ({
  loadLibrarySource: async () => ({ kind: 'folder', handle }),
  loadSongInfos: async () => [...savedInfos],
  replaceLibrary: async () => {
    savedInfos = [];
  },
  putSongInfo: async (info: SongInfo) => {
    savedInfos = [...savedInfos.filter((s) => s.fileName !== info.fileName), info];
  },
  deleteSongs: async (fileNames: readonly string[]) => {
    savedInfos = savedInfos.filter((s) => !fileNames.includes(s.fileName));
  },
  clearSongInfos: async () => {
    savedInfos = [];
  },
  putStoredSong: async () => {},
  loadStoredSongData: async () => null,
}));

const { createLibraryController } = await import('./useLibrary.ts');

describe('createLibraryController', () => {
  beforeEach(() => {
    folderNames = ['帰り道の歌.mid', '夕焼けの坂道.mid', '星降る丘.mid'];
    savedInfos = [
      { fileName: '帰り道の歌.mid', title: '帰り道の歌' },
      { fileName: '夕焼けの坂道.mid', title: '夕焼けの坂道' },
    ];
    readGates = new Map();
  });

  test('rereadAll keeps every song when a refresh starts while it waits', async () => {
    let songs: string[] = [];
    const controller = createLibraryController((state) => {
      songs = state.songs.map((s) => s.fileName);
    });
    const firstRead = blockNextRead('星降る丘.mid');
    const refreshRead = blockNextRead('星降る丘.mid');
    await controller.init();
    await flush();

    controller.actions.rereadAll();
    await flush();
    controller.actions.refresh({ prompt: false });
    await flush();
    firstRead.resolve();
    await flush();
    refreshRead.resolve();
    await flush();

    expect(songs.toSorted()).toEqual(
      ['夕焼けの坂道.mid', '帰り道の歌.mid', '星降る丘.mid'].toSorted(),
    );
    expect(savedInfos.map((s) => s.fileName).toSorted()).toEqual(songs.toSorted());
  });
});
