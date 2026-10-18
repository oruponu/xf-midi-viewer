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

function truncatedSmfBytes(): ArrayBuffer {
  return new Uint8Array(smfBytes()).slice(0, -2).buffer;
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
    states.map((state) => [
      state.current?.file.name ?? null,
      state.pending?.name ?? null,
      state.failure?.file.name ?? null,
    ]);
  return { states, loader, summary };
}

async function loadBytes(
  loader: ReturnType<typeof createSongLoader>,
  name: string,
  bytes: ArrayBuffer,
  beforeSwap?: () => void,
) {
  const source = controlledSource(name);
  const done = loader.load(source.source, beforeSwap);
  source.resolve(bytes);
  await done;
}

describe('createSongLoader', () => {
  test('reports loading and then the loaded song', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.resolve(smfBytes());
    await done;

    expect(summary()).toEqual([
      [null, 'a.mid', null],
      ['a.mid', null, null],
    ]);
    expect(states.at(-1)!.current?.song.sequence.durationTicks).toBe(0);
  });

  test('reports an error for bytes that are not an SMF', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.resolve(brokenBytes());
    await done;

    expect(summary()).toEqual([
      [null, 'a.mid', null],
      [null, null, 'a.mid'],
    ]);
    expect(states.at(-1)!.failure?.reason).toBe('notSmf');
  });

  test('reports a broken SMF with the parser detail', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.resolve(truncatedSmfBytes());
    await done;

    expect(summary()).toEqual([
      [null, 'a.mid', null],
      [null, null, 'a.mid'],
    ]);
    const failure = states.at(-1)!.failure;
    expect(failure?.reason).toBe('broken');
    expect(failure && failure.detail.length > 0).toBe(true);
  });

  test('reports an error when reading the file fails', async () => {
    const { states, loader, summary } = record();
    const a = controlledSource('a.mid');

    const done = loader.load(a.source);
    a.reject(new Error('read failed'));
    await done;

    expect(summary()).toEqual([
      [null, 'a.mid', null],
      [null, null, 'a.mid'],
    ]);
    const failure = states.at(-1)!.failure;
    expect(failure?.reason).toBe('readFailed');
    expect(failure?.detail).toBe('read failed');
  });

  test('keeps the current song while the next file loads and after it fails', async () => {
    const { states, loader, summary } = record();
    await loadBytes(loader, 'a.mid', smfBytes());
    const b = controlledSource('b.mid');

    const done = loader.load(b.source);
    b.resolve(brokenBytes());
    await done;

    expect(summary()).toEqual([
      [null, 'a.mid', null],
      ['a.mid', null, null],
      ['a.mid', 'b.mid', null],
      ['a.mid', null, 'b.mid'],
    ]);
    expect(states.at(-1)!.failure?.reason).toBe('notSmf');
  });

  test('keeps the failure while the next file loads without a song', async () => {
    const { loader, summary } = record();
    await loadBytes(loader, 'a.mid', brokenBytes());

    void loader.load(controlledSource('b.mid').source);

    expect(summary().at(-1)).toEqual([null, 'b.mid', 'a.mid']);
  });

  test('clears the failure when a load succeeds', async () => {
    const { loader, summary } = record();
    await loadBytes(loader, 'a.mid', smfBytes());
    await loadBytes(loader, 'b.mid', brokenBytes());
    await loadBytes(loader, 'c.mid', smfBytes());

    expect(summary().at(-1)).toEqual(['c.mid', null, null]);
  });

  test('gives each failure a new id', async () => {
    const { states, loader } = record();
    await loadBytes(loader, 'a.mid', brokenBytes());
    const first = states.at(-1)!.failure;
    await loadBytes(loader, 'a.mid', brokenBytes());
    const second = states.at(-1)!.failure;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
  });

  test('calls beforeSwap right before switching to the new song', async () => {
    const { states, loader } = record();
    const notifiedAtSwap: number[] = [];

    await loadBytes(loader, 'a.mid', smfBytes(), () => notifiedAtSwap.push(states.length));

    expect(notifiedAtSwap).toEqual([1]);
    expect(states).toHaveLength(2);
  });

  test('does not call beforeSwap when the load fails', async () => {
    const { loader } = record();
    await loadBytes(loader, 'a.mid', smfBytes());
    let calls = 0;

    await loadBytes(loader, 'b.mid', brokenBytes(), () => calls++);

    expect(calls).toBe(0);
  });

  test('does not call beforeSwap for a stale load', async () => {
    const { states, loader } = record();
    const a = controlledSource('a.mid');
    const b = controlledSource('b.mid');
    let callsA = 0;
    let callsB = 0;

    const doneA = loader.load(a.source, () => callsA++);
    const doneB = loader.load(b.source, () => callsB++);
    b.resolve(smfBytes());
    await doneB;
    a.resolve(smfBytes());
    await doneA;

    expect(callsA).toBe(0);
    expect(callsB).toBe(1);
    expect(states.at(-1)!.current?.file.name).toBe('b.mid');
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
      [null, 'a.mid', null],
      [null, 'b.mid', null],
      ['b.mid', null, null],
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
      [null, 'a.mid', null],
      [null, 'b.mid', null],
      ['b.mid', null, null],
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
      [null, 'a.mid', null],
      [null, 'b.mid', null],
      [null, null, 'b.mid'],
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
      [null, 'a.mid', null],
      [null, 'b.mid', null],
      ['b.mid', null, null],
    ]);
  });
});
