export type MidiOutputLike = Pick<MIDIOutput, 'send'> & {
  clear?: () => void;
  latencyMs?: () => number;
};

export interface MidiSendFailure {
  error: unknown;
}

export function trySendMidiMessage(
  output: Pick<MIDIOutput, 'send'>,
  data: number[],
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): boolean {
  try {
    output.send(data, timestamp);
    return true;
  } catch (error) {
    onFailure?.({ error });
    return false;
  }
}

export function isLiveNoteOn(data: number[]): boolean {
  return (data[0]! & 0xf0) === 0x90 && (data[2] ?? 0) > 0;
}

export function isNoteMessage(data: number[]): boolean {
  const status = data[0]! & 0xf0;
  return status === 0x80 || status === 0x90 || status === 0xa0;
}

export function isValidMidiMessage(data: readonly number[]): boolean {
  if (data.length === 0) return false;
  const status = data[0]!;
  if (status < 0x80) return false;
  if (status === 0xf0) {
    return data.length >= 2 && data.at(-1) === 0xf7 && data.slice(1, -1).every(isDataByte);
  }
  return data.length === messageLength(status) && data.slice(1).every(isDataByte);
}

export function splitMidiMessages(bytes: Uint8Array | readonly number[]): number[][] {
  const messages: number[][] = [];
  let start = 0;
  while (start < bytes.length) {
    const status = bytes[start]!;
    if (status < 0x80) {
      start += 1;
      continue;
    }
    let end = start + 1;
    if (status === 0xf0) {
      while (end < bytes.length && bytes[end]! < 0x80) end += 1;
      if (bytes[end] === 0xf7) end += 1;
    } else {
      const length = messageLength(status) ?? 1;
      while (end < bytes.length && end < start + length && bytes[end]! < 0x80) end += 1;
    }
    const message = Array.from(bytes.slice(start, end));
    if (isValidMidiMessage(message)) messages.push(message);
    start = end;
  }
  return messages;
}

function messageLength(status: number): number | null {
  if (status < 0xf0) {
    const type = status & 0xf0;
    return type === 0xc0 || type === 0xd0 ? 2 : 3;
  }
  switch (status) {
    case 0xf1:
    case 0xf3:
      return 2;
    case 0xf2:
      return 3;
    case 0xf6:
    case 0xf8:
    case 0xfa:
    case 0xfb:
    case 0xfc:
    case 0xfe:
    case 0xff:
      return 1;
    default:
      return null;
  }
}

function isDataByte(byte: number): boolean {
  return byte <= 0x7f;
}

export function sendMidiPanic(
  output: MidiOutputLike,
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  try {
    output.clear?.();
  } catch (error) {
    onFailure?.({ error });
  }
  for (let channel = 0; channel < 16; channel += 1) {
    trySendMidiMessage(output, [0xb0 | channel, 120, 0], timestamp, onFailure);
    trySendMidiMessage(output, [0xb0 | channel, 123, 0], timestamp, onFailure);
  }
}

export const GM_SYSTEM_ON: readonly number[] = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
export const XG_SYSTEM_ON: readonly number[] = [
  0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7,
];

export function sendMidiReset(
  output: MidiOutputLike,
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  trySendMidiMessage(output, [...GM_SYSTEM_ON], timestamp, onFailure);
  trySendMidiMessage(output, [...XG_SYSTEM_ON], timestamp, onFailure);
}
