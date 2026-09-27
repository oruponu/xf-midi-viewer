import { transposeMidiData } from './playback.ts';
import type { PlaybackMidiMessage } from './playback.ts';
import type { SmfTiming } from './timing.ts';

export interface KeyShiftChange {
  tick: number;
  semitones: number;
}

const ALL_NOTES_OFF_CONTROLLERS: ReadonlySet<number> = new Set([120, 123, 124, 125, 126, 127]);

function shiftToC(sharps: number): number {
  const semitones = (((-7 * sharps) % 12) + 12) % 12;
  return semitones >= 6 ? semitones - 12 : semitones;
}

export function buildFixedKeyShifts(timing: SmfTiming): KeyShiftChange[] {
  const changes = timing.keySignatures;
  const out: KeyShiftChange[] = [];
  changes.forEach((change, i) => {
    if (changes[i + 1]?.tick === change.tick) return;
    const semitones = shiftToC(change.signature.sharps);
    if (out.length === 0) out.push({ tick: 0, semitones });
    else if (out.at(-1)!.semitones !== semitones) out.push({ tick: change.tick, semitones });
  });
  return out.length > 0 ? out : [{ tick: 0, semitones: 0 }];
}

export function keyShiftAt(tick: number, shifts: readonly KeyShiftChange[]): number {
  let semitones = 0;
  for (const change of shifts) {
    if (change.tick > tick) break;
    semitones = change.semitones;
  }
  return semitones;
}

export function transposeMessages(
  messages: readonly PlaybackMidiMessage[],
  shifts: readonly KeyShiftChange[],
  drumChannels: ReadonlySet<number>,
): PlaybackMidiMessage[] {
  const sounding = Array.from({ length: 16 }, () => new Map<number, number[]>());
  const out: PlaybackMidiMessage[] = [];
  for (const message of messages) {
    const { data } = message;
    const status = data[0]! & 0xf0;
    const notes = sounding[data[0]! & 0x0f]!;
    if (status === 0xb0 && ALL_NOTES_OFF_CONTROLLERS.has(data[1]!)) notes.clear();
    if (data.length < 3 || (status !== 0x80 && status !== 0x90 && status !== 0xa0)) {
      out.push(message);
      continue;
    }
    const queue = notes.get(data[1]!);
    let semitones: number;
    if (status === 0x90 && data[2]! > 0) {
      semitones = keyShiftAt(message.tick, shifts);
      if (queue) queue.push(semitones);
      else notes.set(data[1]!, [semitones]);
    } else if (status === 0xa0) {
      semitones = queue?.[0] ?? keyShiftAt(message.tick, shifts);
    } else {
      semitones = queue?.shift() ?? keyShiftAt(message.tick, shifts);
    }
    const transposed = transposeMidiData(data, semitones, drumChannels);
    if (!transposed) continue;
    out.push(transposed === data ? message : { ...message, data: transposed });
  }
  return out;
}
