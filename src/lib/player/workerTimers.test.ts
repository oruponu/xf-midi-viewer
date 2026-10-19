import { describe, expect, test } from 'bun:test';
import { createWorkerTimers } from './workerTimers.ts';
import type { TimerCommand, TimerWorkerLike } from './workerTimers.ts';
import type { TimerHandle, Timers } from './scheduler.ts';

class FakeWorker implements TimerWorkerLike {
  readonly commands: TimerCommand[] = [];
  onmessage: ((event: MessageEvent<number>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(command: TimerCommand): void {
    this.commands.push(command);
  }

  terminate(): void {
    this.terminated = true;
  }

  tick(id: number): void {
    this.onmessage?.({ data: id } as MessageEvent<number>);
  }

  fail(): void {
    this.onerror?.(new ErrorEvent('error'));
  }
}

class FakeTimers implements Timers {
  private nextHandle = 1;
  readonly active = new Map<TimerHandle, { fn: () => void; ms: number }>();

  setInterval(fn: () => void, ms: number): TimerHandle {
    const handle = this.nextHandle++;
    this.active.set(handle, { fn, ms });
    return handle;
  }

  clearInterval(handle: TimerHandle): void {
    this.active.delete(handle);
  }

  fire(): void {
    for (const { fn } of [...this.active.values()]) fn();
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const fallback = new FakeTimers();
  const timers = createWorkerTimers(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, fallback);
  return { workers, fallback, timers };
}

describe('createWorkerTimers', () => {
  test('creates the worker only when the first interval starts', () => {
    const { workers, timers } = setup();
    expect(workers).toHaveLength(0);

    timers.setInterval(() => {}, 10);
    timers.setInterval(() => {}, 10);

    expect(workers).toHaveLength(1);
  });

  test('runs the callback on each tick from the worker', () => {
    const { workers, timers } = setup();
    let calls = 0;

    const handle = timers.setInterval(() => (calls += 1), 10);
    const worker = workers[0]!;
    worker.tick(handle);
    worker.tick(handle);

    expect(worker.commands).toEqual([{ type: 'set', id: handle, ms: 10 }]);
    expect(calls).toBe(2);
  });

  test('ignores ticks that arrive after the interval is cleared', () => {
    const { workers, timers } = setup();
    let calls = 0;

    const handle = timers.setInterval(() => (calls += 1), 10);
    timers.clearInterval(handle);
    workers[0]!.tick(handle);

    expect(workers[0]!.commands.at(-1)).toEqual({ type: 'clear', id: handle });
    expect(calls).toBe(0);
  });

  test('gives a new handle to each interval so a restarted interval ignores old ticks', () => {
    const { workers, timers } = setup();
    const calls: string[] = [];

    const first = timers.setInterval(() => calls.push('first'), 10);
    timers.clearInterval(first);
    const second = timers.setInterval(() => calls.push('second'), 10);
    workers[0]!.tick(first);
    workers[0]!.tick(second);

    expect(second).not.toBe(first);
    expect(calls).toEqual(['second']);
  });

  test('falls back to the given timers when the worker cannot be created', () => {
    const fallback = new FakeTimers();
    const timers = createWorkerTimers(() => {
      throw new Error('workers are unavailable');
    }, fallback);
    let calls = 0;

    const handle = timers.setInterval(() => (calls += 1), 10);
    fallback.fire();
    timers.clearInterval(handle);

    expect(calls).toBe(1);
    expect(fallback.active.size).toBe(0);
  });

  test('moves running intervals to the fallback timers when the worker fails', () => {
    const { workers, fallback, timers } = setup();
    let calls = 0;

    const handle = timers.setInterval(() => (calls += 1), 10);
    workers[0]!.fail();
    workers[0]!.tick(handle);
    fallback.fire();
    timers.clearInterval(handle);

    expect(workers[0]!.terminated).toBe(true);
    expect(fallback.active.size).toBe(0);
    expect(calls).toBe(1);
  });

  test('uses the fallback timers for intervals started after the worker fails', () => {
    const { workers, fallback, timers } = setup();
    let calls = 0;

    timers.setInterval(() => {}, 10);
    workers[0]!.fail();
    const handle = timers.setInterval(() => (calls += 1), 20);

    expect(workers).toHaveLength(1);
    expect([...fallback.active.values()].map(({ ms }) => ms)).toEqual([10, 20]);
    fallback.fire();
    timers.clearInterval(handle);
    expect(calls).toBe(1);
    expect(fallback.active.size).toBe(1);
  });
});
