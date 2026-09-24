import { describe, expect, test } from 'bun:test';
import { createSongLoader } from './songLoader.ts';
import type { SongSource, SongState } from './songLoader.ts';

function smfBytes(): ArrayBuffer {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4,
    0x00, 0xff, 0x2f, 0x00,
  ]).buffer;
}

function brokenBytes(): ArrayBuffer {
  return new Uint8Array([1, 2, 3]).buffer;
}

function controlledSource(name: string) {
  let resolve!: (buffer: ArrayBuffer) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ArrayBuffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const source: SongSource = { name, size: 1, lastModified: 0, arrayBuffer: () => promise };
  return { source, resolve, reject };
}

function record() {
  const states: SongState[] = [];
  const loader = createSongLoader((state) => states.push(state));
  const summary = () =>
    states.map((state) => [state.status, state.status === 'empty' ? null : state.file.name]);
  return { states, loader, summary };
}

describe('createSongLoader', () => {
  test('reports loading and then the loaded song', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.resolve(smfBytes());
    await done;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['loaded', 'a.mid'],
    ]);
    const last = states.at(-1)!;
    expect(last.status === 'loaded' && last.song.sequence.durationTicks).toBe(0);
  });

  test('reports an error for bytes that are not an SMF', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.resolve(brokenBytes());
    await done;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['error', 'a.mid'],
    ]);
    const last = states.at(-1)!;
    expect(last.status === 'error' && last.message.length > 0).toBe(true);
  });

  test('reports an error when reading the file fails', async () => {
    const { loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.reject(new Error('read failed'));
    await done;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['error', 'a.mid'],
    ]);
  });

  test('ignores an older load that succeeds after a newer one succeeded', async () => {
    const { loader, summary } = record();
    const a = controlledSource('a.mid');
    const b = controlledSource('b.mid');

    const doneA = loader.load(a.source);
    const doneB = loader.load(b.source);
    b.resolve(smfBytes());
    await doneB;
    a.resolve(smfBytes());
    await doneA;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['loading', 'b.mid'],
      ['loaded', 'b.mid'],
    ]);
  });

  test('ignores an older load that fails after a newer one succeeded', async () => {
    const { loader, summary } = record();
    const a = controlledSource('a.mid');
    const b = controlledSource('b.mid');

    const doneA = loader.load(a.source);
    const doneB = loader.load(b.source);
    b.resolve(smfBytes());
    await doneB;
    a.reject(new Error('read failed'));
    await doneA;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['loading', 'b.mid'],
      ['loaded', 'b.mid'],
    ]);
  });

  test('keeps the error of a newer load when an older load succeeds later', async () => {
    const { loader, summary } = record();
    const a = controlledSource('a.mid');
    const b = controlledSource('b.mid');

    const doneA = loader.load(a.source);
    const doneB = loader.load(b.source);
    b.resolve(brokenBytes());
    await doneB;
    a.resolve(smfBytes());
    await doneA;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['loading', 'b.mid'],
      ['error', 'b.mid'],
    ]);
  });

  test('ignores an older load that finishes before the newer one', async () => {
    const { loader, summary } = record();
    const a = controlledSource('a.mid');
    const b = controlledSource('b.mid');

    const doneA = loader.load(a.source);
    const doneB = loader.load(b.source);
    a.resolve(smfBytes());
    await doneA;
    b.resolve(smfBytes());
    await doneB;

    expect(summary()).toEqual([
      ['loading', 'a.mid'],
      ['loading', 'b.mid'],
      ['loaded', 'b.mid'],
    ]);
  });
});
