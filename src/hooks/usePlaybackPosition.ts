import { useSyncExternalStore } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';

type Primitive = string | number | boolean | null | undefined;

export function usePlaybackPosition<T extends Primitive>(
  scheduler: MidiScheduler,
  selector: (seconds: number) => T,
): T {
  return useSyncExternalStore(scheduler.subscribe, () => selector(scheduler.getPositionSnapshot()));
}
