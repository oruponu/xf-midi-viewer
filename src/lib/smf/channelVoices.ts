import { isResetSysex } from '../player/chase.ts';
import { isLiveNoteOn } from '../player/messages.ts';
import { isXgDrumKit, isXgSfxKit } from '../xg/voiceNames.ts';
import {
  DRUM_KIT_BANK_MSB,
  DrumModeTracker,
  SFX_KIT_BANK_MSB,
  xgPartModeChange,
} from './drumMode.ts';
import type { PlaybackMidiMessage } from './playback.ts';

export interface ChannelVoice {
  tick: number;
  seconds: number;
  bankMSB: number;
  bankLSB: number;
  program: number;
  isDrum: boolean;
}

export interface ChannelPart {
  channel: number;
  firstNoteSeconds: number;
  firstNoteVoiceIndex: number;
  voices: ChannelVoice[];
}

interface ChannelState {
  channel: number;
  pendingBankLSB: number;
  bankLSB: number;
  program: number;
  lastKit: { bankMSB: number; program: number };
  voices: ChannelVoice[];
  firstNote: { seconds: number; voiceIndex: number } | null;
}

const CHANNEL_COUNT = 16;
const BANK_SELECT_LSB = 32;

export function buildChannelParts(messages: readonly PlaybackMidiMessage[]): ChannelPart[] {
  const drumMode = new DrumModeTracker();
  const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    createChannelState(channel, drumMode),
  );
  for (const message of messages) {
    const { data } = message;
    const status = data[0]!;
    drumMode.apply(data);
    if (status === 0xf0) {
      applySysex(channels, drumMode, message);
      continue;
    }
    if (status > 0xf0) continue;
    const state = channels[status & 0x0f]!;
    switch (status & 0xf0) {
      case 0x90:
        if (state.firstNote === null && isLiveNoteOn(data)) {
          state.firstNote = { seconds: message.seconds, voiceIndex: state.voices.length - 1 };
        }
        break;
      case 0xb0:
        if (data[1] === BANK_SELECT_LSB) state.pendingBankLSB = data[2]!;
        break;
      case 0xc0:
        state.bankLSB = state.pendingBankLSB;
        state.program = data[1]!;
        pushVoice(state, drumMode, message.tick, message.seconds);
        break;
      default:
        break;
    }
  }
  const parts: ChannelPart[] = [];
  channels.forEach((state, channel) => {
    if (state.firstNote === null) return;
    parts.push({
      channel,
      firstNoteSeconds: state.firstNote.seconds,
      firstNoteVoiceIndex: state.firstNote.voiceIndex,
      voices: state.voices,
    });
  });
  return parts;
}

export function activeVoiceIndex(part: ChannelPart, seconds: number): number {
  if (seconds < part.firstNoteSeconds) return part.firstNoteVoiceIndex;
  let index = part.firstNoteVoiceIndex;
  for (let i = index + 1; i < part.voices.length; i += 1) {
    if (part.voices[i]!.seconds > seconds) break;
    index = i;
  }
  return index;
}

function createChannelState(channel: number, drumMode: DrumModeTracker): ChannelState {
  const state: ChannelState = {
    channel,
    pendingBankLSB: 0,
    bankLSB: 0,
    program: 0,
    lastKit: { bankMSB: DRUM_KIT_BANK_MSB, program: 0 },
    voices: [],
    firstNote: null,
  };
  resetChannel(state, drumMode, 0, 0);
  return state;
}

function resetChannel(
  state: ChannelState,
  drumMode: DrumModeTracker,
  tick: number,
  seconds: number,
): void {
  state.pendingBankLSB = 0;
  state.bankLSB = 0;
  state.program = 0;
  state.lastKit = { bankMSB: DRUM_KIT_BANK_MSB, program: 0 };
  pushVoice(state, drumMode, tick, seconds);
}

// An unsupported drum kit keeps the previous kit (XG Format Specifications, Bank Select Note 4).
function pushVoice(
  state: ChannelState,
  drumMode: DrumModeTracker,
  tick: number,
  seconds: number,
): void {
  const isDrum = drumMode.isDrum(state.channel);
  let bankMSB = drumMode.bankMSB(state.channel);
  let program = state.program;
  if (isDrum) {
    const isSfxKit = bankMSB === SFX_KIT_BANK_MSB;
    if (isSfxKit ? isXgSfxKit(program) : isXgDrumKit(program)) {
      state.lastKit = { bankMSB, program };
    } else if (!isSfxKit) {
      ({ bankMSB, program } = state.lastKit);
    }
  }
  state.voices.push({ tick, seconds, bankMSB, bankLSB: state.bankLSB, program, isDrum });
}

function applySysex(
  channels: ChannelState[],
  drumMode: DrumModeTracker,
  message: PlaybackMidiMessage,
): void {
  if (isResetSysex(message.data)) {
    for (const state of channels) resetChannel(state, drumMode, message.tick, message.seconds);
    return;
  }
  const change = xgPartModeChange(message.data.slice(1));
  if (!change) return;
  pushVoice(channels[change.channel]!, drumMode, message.tick, message.seconds);
}
