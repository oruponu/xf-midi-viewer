import type { TimerCommand } from './workerTimers.ts';

const intervals = new Map<number, ReturnType<typeof setInterval>>();

self.onmessage = (event: MessageEvent<TimerCommand>) => {
  const command = event.data;
  if (command.type === 'set') {
    intervals.set(
      command.id,
      setInterval(() => self.postMessage(command.id), command.ms),
    );
  } else {
    clearInterval(intervals.get(command.id));
    intervals.delete(command.id);
  }
};
