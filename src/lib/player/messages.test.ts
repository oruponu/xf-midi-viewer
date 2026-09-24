import { describe, expect, test } from 'bun:test';
import {
  isLiveNoteOn,
  isNoteMessage,
  isValidMidiMessage,
  sendMidiPanic,
  splitMidiMessages,
  sendMidiReset,
  trySendMidiMessage,
} from './messages.ts';
import type { MidiOutputLike } from './messages.ts';

function createRecordingOutput() {
  const sent: { data: number[]; timestamp: number }[] = [];
  let cleared = 0;
  const output: MidiOutputLike = {
    send(data, timestamp) {
      sent.push({ data: Array.from(data), timestamp: timestamp ?? 0 });
    },
    clear() {
      cleared += 1;
    },
  };
  return { output, sent, clearedCount: () => cleared };
}

describe('trySendMidiMessage', () => {
  test('returns false and reports the error when MIDIOutput.send throws', () => {
    const error = new TypeError('send failed');
    const reports: unknown[] = [];
    const output = {
      send() {
        throw error;
      },
    } as Pick<MIDIOutput, 'send'>;

    const sent = trySendMidiMessage(output, [0x90, 60, 100], 1234, (failure) =>
      reports.push(failure.error),
    );

    expect(sent).toBe(false);
    expect(reports).toEqual([error]);
  });

  test('returns true and forwards data and timestamp when send succeeds', () => {
    const { output, sent } = createRecordingOutput();

    expect(trySendMidiMessage(output, [0x90, 60, 100], 1234)).toBe(true);
    expect(sent).toEqual([{ data: [0x90, 60, 100], timestamp: 1234 }]);
  });
});

describe('isLiveNoteOn', () => {
  test('is true only for note on with velocity above zero', () => {
    expect(isLiveNoteOn([0x90, 60, 100])).toBe(true);
    expect(isLiveNoteOn([0x9f, 60, 1])).toBe(true);
    expect(isLiveNoteOn([0x91, 60, 0])).toBe(false);
    expect(isLiveNoteOn([0x80, 60, 100])).toBe(false);
    expect(isLiveNoteOn([0xb0, 7, 100])).toBe(false);
  });
});

describe('isNoteMessage', () => {
  test('covers note off, note on and polyphonic aftertouch on any channel', () => {
    expect(isNoteMessage([0x80, 60, 0])).toBe(true);
    expect(isNoteMessage([0x9f, 60, 100])).toBe(true);
    expect(isNoteMessage([0xa3, 60, 40])).toBe(true);
    expect(isNoteMessage([0xb0, 7, 100])).toBe(false);
    expect(isNoteMessage([0xc0, 1])).toBe(false);
    expect(isNoteMessage([0xf0, 0x7e, 0xf7])).toBe(false);
  });
});

describe('isValidMidiMessage', () => {
  test('accepts channel messages with the right length and 7-bit data', () => {
    expect(isValidMidiMessage([0x90, 60, 100])).toBe(true);
    expect(isValidMidiMessage([0xc5, 40])).toBe(true);
    expect(isValidMidiMessage([0xef, 0, 64])).toBe(true);
  });

  test('accepts complete sysex, system common and realtime messages', () => {
    expect(isValidMidiMessage([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])).toBe(true);
    expect(isValidMidiMessage([0xf2, 0x10, 0x20])).toBe(true);
    expect(isValidMidiMessage([0xf8])).toBe(true);
  });

  test('rejects wrong lengths and data bytes above 0x7f', () => {
    expect(isValidMidiMessage([])).toBe(false);
    expect(isValidMidiMessage([0x90, 60])).toBe(false);
    expect(isValidMidiMessage([0xc0, 1, 2])).toBe(false);
    expect(isValidMidiMessage([0x90, 60, 0x80])).toBe(false);
    expect(isValidMidiMessage([60, 100])).toBe(false);
  });

  test('rejects unterminated sysex, sysex with a status byte inside and undefined statuses', () => {
    expect(isValidMidiMessage([0xf0, 0x43, 0x10])).toBe(false);
    expect(isValidMidiMessage([0xf0, 0x43, 0x90, 0xf7])).toBe(false);
    expect(isValidMidiMessage([0xf7])).toBe(false);
    expect(isValidMidiMessage([0xf4])).toBe(false);
    expect(isValidMidiMessage([0xfd])).toBe(false);
  });
});

describe('splitMidiMessages', () => {
  test('splits a byte sequence into valid messages and skips broken parts', () => {
    expect(
      splitMidiMessages(
        new Uint8Array([
          0x90, 60, 100, 0x10, 0xf0, 0x43, 0xf7, 0xc0, 0xf8, 0xf0, 0x43, 0x90, 60, 0, 0xf4,
        ]),
      ),
    ).toEqual([[0x90, 60, 100], [0xf0, 0x43, 0xf7], [0xf8], [0x90, 60, 0]]);
  });
});

describe('sendMidiPanic', () => {
  test('clears the queue and sends all-sound-off and all-notes-off on every channel', () => {
    const { output, sent, clearedCount } = createRecordingOutput();

    sendMidiPanic(output, 500);

    expect(clearedCount()).toBe(1);
    expect(sent).toHaveLength(32);
    expect(sent[0]).toEqual({ data: [0xb0, 120, 0], timestamp: 500 });
    expect(sent[1]).toEqual({ data: [0xb0, 123, 0], timestamp: 500 });
    expect(sent[31]).toEqual({ data: [0xbf, 123, 0], timestamp: 500 });
  });

  test('works on outputs without clear()', () => {
    const sent: number[][] = [];
    const output: MidiOutputLike = {
      send(data) {
        sent.push(Array.from(data));
      },
    };

    sendMidiPanic(output, 0);

    expect(sent).toHaveLength(32);
  });

  test('swallows a throwing clear() when no onFailure is given', () => {
    const { output, sent } = createRecordingOutput();
    const error = new Error('clear failed');
    output.clear = () => {
      throw error;
    };

    expect(() => sendMidiPanic(output, 0)).not.toThrow();
    expect(sent).toHaveLength(32);
  });

  test('reports a throwing clear() to onFailure instead of throwing', () => {
    const { output, sent } = createRecordingOutput();
    const error = new Error('clear failed');
    output.clear = () => {
      throw error;
    };
    const reports: unknown[] = [];

    sendMidiPanic(output, 0, (failure) => reports.push(failure.error));

    expect(reports).toEqual([error]);
    expect(sent).toHaveLength(32);
  });
});

describe('sendMidiReset', () => {
  test('sends GM System On followed by XG System On', () => {
    const { output, sent } = createRecordingOutput();

    sendMidiReset(output, 42);

    expect(sent).toEqual([
      { data: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], timestamp: 42 },
      {
        data: [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
        timestamp: 42,
      },
    ]);
  });
});
