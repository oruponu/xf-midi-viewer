import type { PlaybackMidiMessage } from '../smf/playback.ts';

interface Slot {
  message: PlaybackMidiMessage;
  index: number;
}

interface BankState {
  msb: Slot | null;
  lsb: Slot | null;
}

interface ProgramState {
  slot: Slot;
  bank: BankState;
}

type ParameterKind = 'rpn' | 'nrpn';

interface RegisterState {
  msb: number | null;
  lsb: number | null;
}

interface ParameterEntry {
  kind: ParameterKind;
  msb: number;
  lsb: number;
  ops: Slot[];
}

interface ChannelState {
  controllers: (Slot | null)[];
  pendingBank: BankState;
  program: ProgramState | null;
  registers: Record<ParameterKind, RegisterState>;
  selected: ParameterKind | null;
  parameters: Map<string, ParameterEntry>;
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

const BANK_SELECT_MSB = 0;
const DATA_ENTRY_MSB = 6;
const BANK_SELECT_LSB = 32;
const DATA_ENTRY_LSB = 38;
const DATA_INCREMENT = 96;
const DATA_DECREMENT = 97;
const NRPN_LSB = 98;
const NRPN_MSB = 99;
const RPN_LSB = 100;
const RPN_MSB = 101;
const ALL_SOUND_OFF = 120;
const RESET_ALL_CONTROLLERS = 121;
const ALL_NOTES_OFF = 123;

const NULL_PARAMETER = 127;
const RESET_ALL_CONTROLLERS_TARGETS = [1, 11, 64, 65, 66, 67, 84];
const SELECTION_CONTROLLERS: Record<ParameterKind, { msb: number; lsb: number }> = {
  rpn: { msb: RPN_MSB, lsb: RPN_LSB },
  nrpn: { msb: NRPN_MSB, lsb: NRPN_LSB },
};

export function collectChaseMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
): PlaybackMidiMessage[] {
  return emitChaseMessages(reduceChaseState(messages, startIndex));
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
      if (status === 0xf0) applySysex(state, slot);
      continue;
    }
    const channel = state.channels[status & 0x0f]!;
    switch (status & 0xf0) {
      case 0xb0:
        applyControlChange(channel, slot);
        break;
      case 0xc0:
        channel.program = { slot, bank: { ...channel.pendingBank } };
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
  state.channels.forEach((channel, channelNumber) => {
    collectChannelGroups(groups, channel, channelNumber);
  });
  groups.sort((a, b) => a.index - b.index);
  return [
    ...createPrelude(),
    ...groups.flatMap((group) => group.messages),
    ...collectRegisterRestore(state),
  ];
}

export function isResetSysex(data: readonly number[]): boolean {
  return (
    isGmSystemMessage(data) || isXgSystemReset(data) || isGsReset(data) || isGsSystemModeSet(data)
  );
}

function isGmSystemMessage(data: readonly number[]): boolean {
  return (
    data.length === 6 && data[1] === 0x7e && data[3] === 0x09 && data[4]! < 0x10 && data[5] === 0xf7
  );
}

function isXgSystemReset(data: readonly number[]): boolean {
  return (
    data.length === 9 &&
    data[1] === 0x43 &&
    (data[2]! & 0xf0) === 0x10 &&
    data[3] === 0x4c &&
    data[4] === 0x00 &&
    data[5] === 0x00 &&
    (data[6] === 0x7e || data[6] === 0x7f) &&
    data[7] === 0x00 &&
    data[8] === 0xf7
  );
}

function isGsReset(data: readonly number[]): boolean {
  return (
    data.length === 11 &&
    data[1] === 0x41 &&
    data[3] === 0x42 &&
    data[4] === 0x12 &&
    data[5] === 0x40 &&
    data[6] === 0x00 &&
    data[7] === 0x7f &&
    data[8] === 0x00 &&
    data[10] === 0xf7
  );
}

function isGsSystemModeSet(data: readonly number[]): boolean {
  return (
    data.length >= 8 &&
    data[1] === 0x41 &&
    data[3] === 0x42 &&
    data[4] === 0x12 &&
    data[5] === 0x00 &&
    data[6] === 0x00 &&
    data[7] === 0x7f
  );
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
    pendingBank: { msb: null, lsb: null },
    program: null,
    registers: createRegisters(),
    selected: null,
    parameters: new Map(),
    pitchBend: null,
    pressure: null,
  };
}

function createRegisters(): Record<ParameterKind, RegisterState> {
  return { rpn: { msb: null, lsb: null }, nrpn: { msb: null, lsb: null } };
}

function applySysex(state: ChaseState, slot: Slot): void {
  if (isResetSysex(slot.message.data)) {
    state.channels = createChannels();
    state.sysex = [slot];
  } else {
    state.sysex.push(slot);
  }
}

function applyControlChange(channel: ChannelState, slot: Slot): void {
  const controller = slot.message.data[1]!;
  const value = slot.message.data[2]!;
  switch (controller) {
    case BANK_SELECT_MSB:
      channel.pendingBank.msb = slot;
      break;
    case BANK_SELECT_LSB:
      channel.pendingBank.lsb = slot;
      break;
    case DATA_ENTRY_MSB:
    case DATA_ENTRY_LSB:
      applyDataEntry(channel, controller, slot);
      break;
    case NRPN_LSB:
      selectParameter(channel, 'nrpn', 'lsb', value);
      break;
    case NRPN_MSB:
      selectParameter(channel, 'nrpn', 'msb', value);
      break;
    case RPN_LSB:
      selectParameter(channel, 'rpn', 'lsb', value);
      break;
    case RPN_MSB:
      selectParameter(channel, 'rpn', 'msb', value);
      break;
    case DATA_INCREMENT:
    case DATA_DECREMENT:
    case ALL_SOUND_OFF:
    case ALL_NOTES_OFF:
      break;
    case RESET_ALL_CONTROLLERS:
      resetControllers(channel);
      break;
    default:
      channel.controllers[controller] = slot;
  }
}

function selectParameter(
  channel: ChannelState,
  kind: ParameterKind,
  byte: 'msb' | 'lsb',
  value: number,
): void {
  channel.registers[kind][byte] = value;
  channel.selected = kind;
}

function applyDataEntry(channel: ChannelState, controller: number, slot: Slot): void {
  const entry = selectedParameter(channel);
  if (!entry) return;
  entry.ops = entry.ops.filter((op) => op.message.data[1] !== controller);
  entry.ops.push(slot);
}

function selectedParameter(channel: ChannelState): ParameterEntry | null {
  const kind = channel.selected;
  if (!kind) return null;
  const { msb, lsb } = channel.registers[kind];
  if (msb === null || lsb === null) return null;
  if (msb === NULL_PARAMETER && lsb === NULL_PARAMETER) return null;
  const key = `${kind}:${msb}:${lsb}`;
  let entry = channel.parameters.get(key);
  if (!entry) {
    entry = { kind, msb, lsb, ops: [] };
    channel.parameters.set(key, entry);
  }
  return entry;
}

function resetControllers(channel: ChannelState): void {
  for (const controller of RESET_ALL_CONTROLLERS_TARGETS) channel.controllers[controller] = null;
  channel.pitchBend = null;
  channel.pressure = null;
  channel.registers = createRegisters();
  channel.selected = null;
}

function collectChannelGroups(groups: Group[], channel: ChannelState, channelNumber: number): void {
  for (const slot of channel.controllers) {
    if (slot) groups.push(singleGroup(slot));
  }
  if (channel.program) {
    const { slot, bank } = channel.program;
    groups.push({ index: slot.index, messages: presentMessages([bank.msb, bank.lsb, slot]) });
  }
  for (const pending of [channel.pendingBank.msb, channel.pendingBank.lsb]) {
    if (pending && (!channel.program || pending.index > channel.program.slot.index)) {
      groups.push(singleGroup(pending));
    }
  }
  for (const entry of channel.parameters.values()) {
    groups.push(...parameterGroups(channelNumber, entry));
  }
  if (channel.pitchBend) groups.push(singleGroup(channel.pitchBend));
  if (channel.pressure) groups.push(singleGroup(channel.pressure));
}

function parameterGroups(channelNumber: number, entry: ParameterEntry): Group[] {
  const status = 0xb0 | channelNumber;
  const selection = SELECTION_CONTROLLERS[entry.kind];
  return entry.ops.map((op) => ({
    index: op.index,
    messages: [
      synthesize(op.message, [status, selection.msb, entry.msb]),
      synthesize(op.message, [status, selection.lsb, entry.lsb]),
      op.message,
    ],
  }));
}

function collectRegisterRestore(state: ChaseState): PlaybackMidiMessage[] {
  const messages: PlaybackMidiMessage[] = [];
  state.channels.forEach((channel, channelNumber) => {
    const status = 0xb0 | channelNumber;
    const touched = new Set(Array.from(channel.parameters.values(), (entry) => entry.kind));
    const kinds: ParameterKind[] = channel.selected === 'rpn' ? ['nrpn', 'rpn'] : ['rpn', 'nrpn'];
    for (const kind of kinds) {
      const register = channel.registers[kind];
      const selection = SELECTION_CONTROLLERS[kind];
      if (touched.has(kind)) {
        messages.push(synthesizeAtStart([status, selection.msb, register.msb ?? NULL_PARAMETER]));
        messages.push(synthesizeAtStart([status, selection.lsb, register.lsb ?? NULL_PARAMETER]));
        continue;
      }
      if (register.msb !== null) {
        messages.push(synthesizeAtStart([status, selection.msb, register.msb]));
      }
      if (register.lsb !== null) {
        messages.push(synthesizeAtStart([status, selection.lsb, register.lsb]));
      }
    }
  });
  return messages;
}

function createPrelude(): PlaybackMidiMessage[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    synthesizeAtStart([0xb0 | channel, RESET_ALL_CONTROLLERS, 0]),
  );
}

function singleGroup(slot: Slot): Group {
  return { index: slot.index, messages: [slot.message] };
}

function presentSlots(slots: (Slot | null)[]): Slot[] {
  return slots.filter((slot): slot is Slot => slot !== null);
}

function presentMessages(slots: (Slot | null)[]): PlaybackMidiMessage[] {
  return presentSlots(slots).map((slot) => slot.message);
}

function synthesize(anchor: PlaybackMidiMessage, data: number[]): PlaybackMidiMessage {
  return { tick: anchor.tick, seconds: anchor.seconds, data };
}

function synthesizeAtStart(data: number[]): PlaybackMidiMessage {
  return { tick: 0, seconds: 0, data };
}
