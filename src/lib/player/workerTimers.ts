import { windowTimers } from './scheduler.ts';
import type { TimerHandle, Timers } from './scheduler.ts';

export type TimerCommand = { type: 'set'; id: number; ms: number } | { type: 'clear'; id: number };

export interface TimerWorkerLike {
  postMessage(command: TimerCommand): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<number>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface Interval {
  fn: () => void;
  ms: number;
  fallbackHandle: TimerHandle | null;
}

export function createWorkerTimers(createWorker: () => TimerWorkerLike, fallback: Timers): Timers {
  const intervals = new Map<TimerHandle, Interval>();
  let worker: TimerWorkerLike | null = null;
  let failed = false;
  let nextId = 1;

  const switchToFallback = () => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    failed = true;
    for (const interval of intervals.values()) {
      interval.fallbackHandle = fallback.setInterval(interval.fn, interval.ms);
    }
  };

  const ensureWorker = (): TimerWorkerLike | null => {
    if (worker || failed) return worker;
    try {
      worker = createWorker();
    } catch {
      failed = true;
      return null;
    }
    worker.onmessage = (event) => intervals.get(event.data)?.fn();
    worker.onerror = switchToFallback;
    return worker;
  };

  return {
    setInterval(fn, ms) {
      const id = nextId++;
      const current = ensureWorker();
      intervals.set(id, { fn, ms, fallbackHandle: current ? null : fallback.setInterval(fn, ms) });
      current?.postMessage({ type: 'set', id, ms });
      return id;
    },
    clearInterval(handle) {
      const interval = intervals.get(handle);
      if (!interval) return;
      intervals.delete(handle);
      if (interval.fallbackHandle !== null) fallback.clearInterval(interval.fallbackHandle);
      else worker?.postMessage({ type: 'clear', id: handle });
    },
  };
}

// Hidden pages throttle main-thread timers to once a second or slower, far beyond the
// lookahead, while timers in a dedicated worker keep running.
export function createSchedulerTimers(): Timers {
  return createWorkerTimers(
    () => new Worker(new URL('./timerWorker.ts', import.meta.url), { type: 'module' }),
    windowTimers,
  );
}
