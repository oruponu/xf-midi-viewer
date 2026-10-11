import { isResetSysex, isXgSystemReset } from '../player/chase.ts';
import { DRUM_KIT_BANK_MSB } from '../smf/drumMode.ts';
import { isXgDrumKit } from '../xg/voiceNames.ts';
import type { SynthLike } from './builtinOutput.ts';

const CHANNEL_COUNT = 16;
const DRUM_CHANNEL = 9;
const BANK_SELECT_MSB = 0;
const STANDARD_KIT = 0;

// An unsupported drum kit keeps the previous kit (XG Format Specifications, Bank Select Note 4).
export class XgDrumKitFallback {
  enabled = false;
  private xg = false;
  private bankMSB = initialBankMSB();
  private lastKit = new Array<number>(CHANNEL_COUNT).fill(STANDARD_KIT);

  apply(data: readonly number[]): readonly number[] {
    const status = data[0];
    if (status === undefined) return data;
    if (status === 0xf0) {
      if (isResetSysex(data)) {
        this.xg = isXgSystemReset(data);
        this.bankMSB = initialBankMSB();
        this.lastKit.fill(STANDARD_KIT);
      }
      return data;
    }
    if (status > 0xf0) return data;
    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0xb0: {
        const value = data[2];
        if (data[1] === BANK_SELECT_MSB && value !== undefined) this.bankMSB[channel] = value;
        return data;
      }
      case 0xc0: {
        const program = data[1];
        if (program === undefined || !this.xg || this.bankMSB[channel] !== DRUM_KIT_BANK_MSB) {
          return data;
        }
        if (isXgDrumKit(program)) {
          this.lastKit[channel] = program;
          return data;
        }
        return this.enabled ? [status, this.lastKit[channel]!] : data;
      }
      default:
        return data;
    }
  }
}

function initialBankMSB(): number[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    channel === DRUM_CHANNEL ? DRUM_KIT_BANK_MSB : 0,
  );
}

export function withXgDrumKitFallback(synth: SynthLike, fallback: XgDrumKitFallback): SynthLike {
  return {
    sendMessage(message, channelOffset, eventOptions) {
      const data = fallback.apply(Array.from(message));
      if (eventOptions === undefined) {
        synth.sendMessage(data, channelOffset);
        return;
      }
      synth.sendMessage(data, channelOffset, eventOptions);
    },
  };
}
