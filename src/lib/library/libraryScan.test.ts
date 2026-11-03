import { describe, expect, test } from 'bun:test';
import { importSongs, scanFolder } from './libraryScan.ts';

function smfBytes(): ArrayBuffer {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4,
    0x00, 0xff, 0x2f, 0x00,
  ]).buffer;
}

describe('scanFolder', () => {
  test('reads only new names and reports removed ones', async () => {
    const read: string[] = [];
    const added: string[] = [];
    const removed: string[][] = [];
    const result = await scanFolder({
      names: ['a.mid', 'c.mid'],
      known: new Set(['a.mid', 'b.mid']),
      readFile: async (name) => {
        read.push(name);
        return smfBytes();
      },
      onRemoved: async (names) => void removed.push(names),
      onAdded: async (info) => void added.push(info.fileName),
      isCancelled: () => false,
    });

    expect(read).toEqual(['c.mid']);
    expect(added).toEqual(['c.mid']);
    expect(removed).toEqual([['b.mid']]);
    expect(result).toEqual({ failed: [] });
  });

  test('continues past files that cannot be read', async () => {
    const added: string[] = [];
    const result = await scanFolder({
      names: ['a.mid', 'b.mid'],
      known: new Set(),
      readFile: async (name) => {
        if (name === 'a.mid') throw new Error('gone');
        return smfBytes();
      },
      onRemoved: async () => {},
      onAdded: async (info) => void added.push(info.fileName),
      isCancelled: () => false,
    });

    expect(added).toEqual(['b.mid']);
    expect(result).toEqual({ failed: ['a.mid'] });
  });

  test('stops when cancelled', async () => {
    let cancelled = false;
    const added: string[] = [];
    await scanFolder({
      names: ['a.mid', 'b.mid'],
      known: new Set(),
      readFile: async () => smfBytes(),
      onRemoved: async () => {},
      onAdded: async (info) => {
        added.push(info.fileName);
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });

    expect(added).toEqual(['a.mid']);
  });

  test('does not add a song whose read finishes after cancellation', async () => {
    let cancelled = false;
    const added: string[] = [];
    await scanFolder({
      names: ['a.mid'],
      known: new Set(),
      readFile: async () => {
        cancelled = true;
        return smfBytes();
      },
      onRemoved: async () => {},
      onAdded: async (info) => void added.push(info.fileName),
      isCancelled: () => cancelled,
    });

    expect(added).toEqual([]);
  });
});

describe('importSongs', () => {
  const midi = (name: string) => new File([smfBytes()], name);

  test('skips known and duplicate names', async () => {
    const saved: string[] = [];
    const result = await importSongs({
      files: [midi('a.mid'), midi('b.mid'), midi('b.mid')],
      known: new Set(['a.mid']),
      save: async (info) => void saved.push(info.fileName),
      onAdded: () => {},
      isCancelled: () => false,
    });

    expect(saved).toEqual(['b.mid']);
    expect(result).toEqual({ added: 1, failed: [], quotaExceeded: false });
  });

  test('stops at a quota error and keeps the saved songs', async () => {
    const added: string[] = [];
    const result = await importSongs({
      files: [midi('a.mid'), midi('b.mid'), midi('c.mid')],
      known: new Set(),
      save: async (info) => {
        if (info.fileName === 'b.mid') throw new DOMException('full', 'QuotaExceededError');
      },
      onAdded: (info) => added.push(info.fileName),
      isCancelled: () => false,
    });

    expect(added).toEqual(['a.mid']);
    expect(result).toEqual({ added: 1, failed: [], quotaExceeded: true });
  });

  test('records files that cannot be saved for other reasons and continues', async () => {
    const result = await importSongs({
      files: [midi('a.mid'), midi('b.mid')],
      known: new Set(),
      save: async (info) => {
        if (info.fileName === 'a.mid') throw new Error('write failed');
      },
      onAdded: () => {},
      isCancelled: () => false,
    });

    expect(result).toEqual({ added: 1, failed: ['a.mid'], quotaExceeded: false });
  });

  test('does not save a song whose read finishes after cancellation', async () => {
    let cancelled = false;
    const saved: string[] = [];
    const file = midi('a.mid');
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = async () => {
      cancelled = true;
      return read();
    };
    await importSongs({
      files: [file],
      known: new Set(),
      save: async (info) => void saved.push(info.fileName),
      onAdded: () => {},
      isCancelled: () => cancelled,
    });

    expect(saved).toEqual([]);
  });
});
