export type MidiOutputLike = Pick<MIDIOutput, 'send'> & {
  clear?: () => void;
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

export function sendMidiPanic(
  output: MidiOutputLike,
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  output.clear?.();
  for (let channel = 0; channel < 16; channel += 1) {
    trySendMidiMessage(output, [0xb0 | channel, 120, 0], timestamp, onFailure);
    trySendMidiMessage(output, [0xb0 | channel, 123, 0], timestamp, onFailure);
  }
}

export function sendMidiReset(
  output: MidiOutputLike,
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  trySendMidiMessage(
    output,
    [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
    timestamp,
    onFailure,
  );
  trySendMidiMessage(
    output,
    [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
    timestamp,
    onFailure,
  );
}
