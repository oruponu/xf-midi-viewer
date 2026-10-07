import { isResetSysex } from '../player/chase.ts';

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
    return state.partMode ?? DRUM_BANK_MSBS.has(state.bankMSB);
  }

  bankMSB(channel: number): number {
    return this.channels[channel]!.bankMSB;
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
