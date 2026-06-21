import { describe, expect, test } from 'bun:test';
import {
  collectChaseMessages,
  scheduleDueMidiMessages,
  trySendMidiMessage,
} from './useMidiPlayer.ts';
import type { PlaybackMidiMessage } from '../lib/smf/playback.ts';

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
});

describe('collectChaseMessages', () => {
  const messages: PlaybackMidiMessage[] = [
    { tick: 0, seconds: 0, data: [0xb0, 0, 1] },
    { tick: 0, seconds: 0, data: [0xc0, 48] },
    { tick: 0, seconds: 0, data: [0xb0, 7, 100] },
    { tick: 0, seconds: 0, data: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7] },
    // note on / off / poly aftertouch are skipped
    { tick: 240, seconds: 0.25, data: [0x90, 60, 100] },
    { tick: 240, seconds: 0.25, data: [0xa0, 60, 40] },
    { tick: 480, seconds: 0.5, data: [0x80, 60, 0] },
    { tick: 720, seconds: 0.75, data: [0xb0, 7, 64] },
  ];

  test('keeps non-note state messages before the seek index so voices survive a seek', () => {
    expect(collectChaseMessages(messages, 7)).toEqual([
      messages[0]!,
      messages[1]!,
      messages[2]!,
      messages[3]!,
    ]);
  });

  test('returns nothing when starting from the beginning', () => {
    expect(collectChaseMessages(messages, 0)).toEqual([]);
  });
});

describe('scheduleDueMidiMessages', () => {
  test('advances past a failed message so the same message is not retried forever', () => {
    const messages: PlaybackMidiMessage[] = [
      { tick: 480, seconds: 0.5, data: [0x90, 60, 100] },
      { tick: 960, seconds: 1, data: [0x80, 60, 0] },
    ];
    const attempts: PlaybackMidiMessage[] = [];

    const result = scheduleDueMidiMessages(
      messages,
      0,
      0.45,
      0.55,
      (message) => {
        attempts.push(message);
        return false;
      },
    );

    expect(attempts).toEqual([messages[0]]);
    expect(result).toEqual({ nextIndex: 1, failed: true });
  });
});
