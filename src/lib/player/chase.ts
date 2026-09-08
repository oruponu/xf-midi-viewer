import type { PlaybackMidiMessage } from '../smf/playback.ts';
import { isNoteMessage } from './messages.ts';

interface Slot {
  message: PlaybackMidiMessage;
  index: number;
}

interface ChannelState {
  controllers: (Slot | null)[];
  pitchBend: Slot | null;
  pressure: Slot | null;
}

export interface ChaseState {
  channels: ChannelState[];
  sysex: Slot[];
}

interface Group {
  index: number;
  messages: PlaybackMidiMessage[];
}

const CHANNEL_COUNT = 16;
const CONTROLLER_COUNT = 128;

const ALL_SOUND_OFF = 120;
const RESET_ALL_CONTROLLERS = 121;
const ALL_NOTES_OFF = 123;

export function collectChaseMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
): PlaybackMidiMessage[] {
  const chase: PlaybackMidiMessage[] = [];
  for (let i = 0; i < startIndex; i += 1) {
    const message = messages[i]!;
    if (!isNoteMessage(message.data)) chase.push(message);
  }
  return chase;
}

export function reduceChaseState(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
): ChaseState {
  const state = createChaseState();
  for (let index = 0; index < startIndex; index += 1) {
    const message = messages[index]!;
    const slot: Slot = { message, index };
    const status = message.data[0]!;
    if (status >= 0xf0) {
      if (status === 0xf0) state.sysex.push(slot);
      continue;
    }
    const channel = state.channels[status & 0x0f]!;
    switch (status & 0xf0) {
      case 0xb0:
        applyControlChange(channel, slot);
        break;
      case 0xd0:
        channel.pressure = slot;
        break;
      case 0xe0:
        channel.pitchBend = slot;
        break;
      default:
        break;
    }
  }
  return state;
}

export function emitChaseMessages(state: ChaseState): PlaybackMidiMessage[] {
  const groups: Group[] = state.sysex.map(singleGroup);
  for (const channel of state.channels) collectChannelGroups(groups, channel);
  groups.sort((a, b) => a.index - b.index);
  return [...createPrelude(), ...groups.flatMap((group) => group.messages)];
}

function createChaseState(): ChaseState {
  return { channels: createChannels(), sysex: [] };
}

function createChannels(): ChannelState[] {
  return Array.from({ length: CHANNEL_COUNT }, createChannelState);
}

function createChannelState(): ChannelState {
  return {
    controllers: new Array<Slot | null>(CONTROLLER_COUNT).fill(null),
    pitchBend: null,
    pressure: null,
  };
}

function applyControlChange(channel: ChannelState, slot: Slot): void {
  const controller = slot.message.data[1]!;
  switch (controller) {
    case ALL_SOUND_OFF:
    case ALL_NOTES_OFF:
      break;
    default:
      channel.controllers[controller] = slot;
  }
}

function collectChannelGroups(groups: Group[], channel: ChannelState): void {
  for (const slot of channel.controllers) {
    if (slot) groups.push(singleGroup(slot));
  }
  if (channel.pitchBend) groups.push(singleGroup(channel.pitchBend));
  if (channel.pressure) groups.push(singleGroup(channel.pressure));
}

function createPrelude(): PlaybackMidiMessage[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    synthesizeAtStart([0xb0 | channel, RESET_ALL_CONTROLLERS, 0]),
  );
}

function singleGroup(slot: Slot): Group {
  return { index: slot.index, messages: [slot.message] };
}

function synthesizeAtStart(data: number[]): PlaybackMidiMessage {
  return { tick: 0, seconds: 0, data };
}
