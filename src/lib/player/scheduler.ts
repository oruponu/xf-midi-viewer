import type { PlaybackMidiMessage } from '../smf/playback.ts';
import { isLiveNoteOn } from './messages.ts';

export const LOOKAHEAD_SECONDS = 0.05;
export const SCHEDULER_MS = 10;
export const UI_UPDATE_INTERVAL_MS = 33;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2.0;
export const PLAYBACK_RATE_STEP = 0.1;
export const KEY_SHIFT_MIN = -6;
export const KEY_SHIFT_MAX = 6;
export const KEY_SHIFT_STEP = 1;

export interface MidiScheduleWindowResult {
  nextIndex: number;
  failed: boolean;
}

export function scheduleDueMidiMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
  position: number,
  until: number,
  scheduleMessage: (message: PlaybackMidiMessage) => boolean,
): MidiScheduleWindowResult {
  let i = startIndex;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.seconds > until) break;
    if (message.seconds >= position || !isLiveNoteOn(message.data)) {
      const sent = scheduleMessage(message);
      i += 1;
      if (!sent) return { nextIndex: i, failed: true };
      continue;
    }
    i += 1;
  }
  return { nextIndex: i, failed: false };
}

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const clamped = Math.max(PLAYBACK_RATE_MIN, Math.min(PLAYBACK_RATE_MAX, rate));
  return Math.round(clamped * 10) / 10;
}

export function clampKeyShift(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(KEY_SHIFT_MIN, Math.min(KEY_SHIFT_MAX, Math.round(semitones)));
}

export function firstMidiMessageIndexAtOrAfter(
  messages: readonly PlaybackMidiMessage[],
  seconds: number,
): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (messages[mid]!.seconds < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
