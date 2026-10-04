import { isResetSysex } from '../player/chase.ts';
import { isLiveNoteOn } from '../player/messages.ts';
import { isXgDrumKit } from '../xg/voiceNames.ts';
import { xgPartModeChange } from './playback.ts';
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
  pendingBankMSB: number;
  pendingBankLSB: number;
  bankMSB: number;
  bankLSB: number;
  program: number;
  lastKit: number;
  drumMode: boolean | null;
  voices: ChannelVoice[];
  firstNote: { seconds: number; voiceIndex: number } | null;
}

const CHANNEL_COUNT = 16;
const DRUM_CHANNEL = 9;
const SFX_KIT_BANK_MSB = 126;
const DRUM_KIT_BANK_MSB = 127;
const DRUM_BANK_MSBS: ReadonlySet<number> = new Set([SFX_KIT_BANK_MSB, DRUM_KIT_BANK_MSB]);
const BANK_SELECT_MSB = 0;
const BANK_SELECT_LSB = 32;

export function buildChannelParts(messages: readonly PlaybackMidiMessage[]): ChannelPart[] {
  const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    createChannelState(channel),
  );
  for (const message of messages) {
    const { data } = message;
    const status = data[0]!;
    if (status === 0xf0) {
      applySysex(channels, message);
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
        if (data[1] === BANK_SELECT_MSB) {
          state.pendingBankMSB = data[2]!;
          if (DRUM_BANK_MSBS.has(state.pendingBankMSB)) state.drumMode = null;
        } else if (data[1] === BANK_SELECT_LSB) {
          state.pendingBankLSB = data[2]!;
        }
        break;
      case 0xc0:
        state.bankMSB = state.pendingBankMSB;
        state.bankLSB = state.pendingBankLSB;
        state.program = data[1]!;
        pushVoice(state, message.tick, message.seconds);
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

function createChannelState(channel: number): ChannelState {
  const state: ChannelState = {
    pendingBankMSB: 0,
    pendingBankLSB: 0,
    bankMSB: 0,
    bankLSB: 0,
    program: 0,
    lastKit: 0,
    drumMode: null,
    voices: [],
    firstNote: null,
  };
  resetChannel(state, channel, 0, 0);
  return state;
}

function resetChannel(state: ChannelState, channel: number, tick: number, seconds: number): void {
  const bankMSB = channel === DRUM_CHANNEL ? DRUM_KIT_BANK_MSB : 0;
  state.pendingBankMSB = bankMSB;
  state.pendingBankLSB = 0;
  state.bankMSB = bankMSB;
  state.bankLSB = 0;
  state.program = 0;
  state.lastKit = 0;
  state.drumMode = null;
  pushVoice(state, tick, seconds);
}

// An unsupported drum kit keeps the previous kit (XG Format Specifications, Bank Select Note 4).
function pushVoice(state: ChannelState, tick: number, seconds: number): void {
  const isDrum = state.drumMode ?? DRUM_BANK_MSBS.has(state.bankMSB);
  let program = state.program;
  if (isDrum && state.bankMSB !== SFX_KIT_BANK_MSB) {
    if (isXgDrumKit(program)) state.lastKit = program;
    else program = state.lastKit;
  }
  state.voices.push({
    tick,
    seconds,
    bankMSB: state.bankMSB,
    bankLSB: state.bankLSB,
    program,
    isDrum,
  });
}

function applySysex(channels: ChannelState[], message: PlaybackMidiMessage): void {
  if (isResetSysex(message.data)) {
    channels.forEach((state, channel) =>
      resetChannel(state, channel, message.tick, message.seconds),
    );
    return;
  }
  const change = xgPartModeChange(message.data.slice(1));
  if (!change) return;
  const state = channels[change.channel]!;
  state.drumMode = change.isDrum;
  pushVoice(state, message.tick, message.seconds);
}
