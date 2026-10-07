import { isResetSysex } from '../player/chase.ts';
import { ALL_NOTES_OFF_CONTROLLERS, isLiveNoteOn } from '../player/messages.ts';
import type { PlaybackMidiMessage } from './playback.ts';

export interface XgPartModeChange {
  channel: number;
  isDrum: boolean;
}

interface ChannelDrumMode {
  pendingBankMSB: number;
  bankMSB: number;
  partMode: boolean | null;
  clearsPartMode: boolean;
}

export const SFX_KIT_BANK_MSB = 126;
export const DRUM_KIT_BANK_MSB = 127;
const DRUM_BANK_MSBS: ReadonlySet<number> = new Set([SFX_KIT_BANK_MSB, DRUM_KIT_BANK_MSB]);
const CHANNEL_COUNT = 16;
const DRUM_CHANNEL = 9;
const BANK_SELECT_MSB = 0;

export class DrumModeTracker {
  private channels: ChannelDrumMode[] = initialChannels();

  apply(data: readonly number[]): void {
    const status = data[0]!;
    if (status === 0xf0) {
      if (isResetSysex(data)) {
        this.channels = initialChannels();
        return;
      }
      const change = xgPartModeChange(data.slice(1));
      if (!change) return;
      const state = this.channels[change.channel]!;
      state.partMode = change.isDrum;
      state.clearsPartMode = false;
      return;
    }
    if (status > 0xf0) return;
    const state = this.channels[status & 0x0f]!;
    switch (status & 0xf0) {
      case 0xb0:
        if (data[1] !== BANK_SELECT_MSB) break;
        state.pendingBankMSB = data[2]!;
        if (DRUM_BANK_MSBS.has(state.pendingBankMSB)) state.clearsPartMode = true;
        break;
      case 0xc0:
        state.bankMSB = state.pendingBankMSB;
        if (state.clearsPartMode) {
          state.partMode = null;
          state.clearsPartMode = false;
        }
        break;
      default:
        break;
    }
  }

  isDrum(channel: number): boolean {
    const state = this.channels[channel]!;
    return state.partMode ?? (channel === DRUM_CHANNEL || DRUM_BANK_MSBS.has(state.bankMSB));
  }

  bankMSB(channel: number): number {
    return this.channels[channel]!.bankMSB;
  }
}

export function markDrumNotes(messages: readonly PlaybackMidiMessage[]): void {
  const drumMode = new DrumModeTracker();
  const sounding = Array.from({ length: CHANNEL_COUNT }, () => new Map<number, boolean[]>());
  for (const message of messages) {
    const { data } = message;
    const status = data[0]!;
    if (status === 0xf0 && isResetSysex(data)) {
      for (const notes of sounding) notes.clear();
    }
    drumMode.apply(data);
    if (status >= 0xf0) continue;
    const channel = status & 0x0f;
    const notes = sounding[channel]!;
    const kind = status & 0xf0;
    if (kind === 0xb0 && ALL_NOTES_OFF_CONTROLLERS.has(data[1]!)) {
      notes.clear();
      continue;
    }
    if (kind !== 0x80 && kind !== 0x90 && kind !== 0xa0) continue;
    const queue = notes.get(data[1]!);
    let isDrum: boolean;
    if (isLiveNoteOn(data)) {
      isDrum = drumMode.isDrum(channel);
      if (queue) queue.push(isDrum);
      else notes.set(data[1]!, [isDrum]);
    } else if (kind === 0xa0) {
      isDrum = queue?.[0] ?? drumMode.isDrum(channel);
    } else {
      isDrum = queue?.shift() ?? drumMode.isDrum(channel);
    }
    if (isDrum) message.isDrum = true;
  }
}

function initialChannels(): ChannelDrumMode[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, channel) => {
    const bankMSB = channel === DRUM_CHANNEL ? DRUM_KIT_BANK_MSB : 0;
    return { pendingBankMSB: bankMSB, bankMSB, partMode: null, clearsPartMode: false };
  });
}

export function xgPartModeChange(data: ArrayLike<number>): XgPartModeChange | null {
  if (data.length < 8) return null;
  if (data[0] !== 0x43) return null;
  if ((data[1]! & 0xf0) !== 0x10) return null;
  if (data[2] !== 0x4c) return null;
  if (data[3] !== 0x08) return null;
  if (data[5] !== 0x07) return null;
  const mode = data[6]!;
  if (mode > 3) return null;
  const part = data[4]!;
  return part <= 15 ? { channel: part, isDrum: mode !== 0 } : null;
}
