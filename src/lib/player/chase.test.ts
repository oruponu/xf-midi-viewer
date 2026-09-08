import { describe, expect, test } from 'bun:test';
import { collectChaseMessages, emitChaseMessages, reduceChaseState } from './chase.ts';
import type { PlaybackMidiMessage } from '../smf/playback.ts';

const PRELUDE = Array.from({ length: 16 }, (_, channel) => [0xb0 | channel, 121, 0]);

function sequence(...datas: number[][]): PlaybackMidiMessage[] {
  return datas.map((data, index) => ({ tick: index * 120, seconds: index * 0.125, data }));
}

function fold(messages: PlaybackMidiMessage[], startIndex = messages.length): number[][] {
  return emitChaseMessages(reduceChaseState(messages, startIndex)).map((message) => message.data);
}

function body(messages: PlaybackMidiMessage[], startIndex = messages.length): number[][] {
  return fold(messages, startIndex).slice(PRELUDE.length);
}

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

describe('chase prelude', () => {
  test('starts with Reset All Controllers on every channel even when starting from the beginning', () => {
    expect(fold(sequence([0xb0, 7, 100]), 0)).toEqual(PRELUDE);
  });

  test('puts the prelude before the folded state', () => {
    expect(fold(sequence([0xb0, 7, 100]))).toEqual([...PRELUDE, [0xb0, 7, 100]]);
  });
});

describe('chase channel messages', () => {
  test('keeps only the last value of each controller per channel', () => {
    expect(body(sequence([0xb0, 7, 100], [0xb1, 7, 90], [0xb0, 7, 64]))).toEqual([
      [0xb1, 7, 90],
      [0xb0, 7, 64],
    ]);
  });

  test('keeps only the last pitch bend and channel pressure per channel', () => {
    expect(body(sequence([0xe0, 0, 64], [0xd0, 10], [0xe0, 0, 32], [0xd0, 20]))).toEqual([
      [0xe0, 0, 32],
      [0xd0, 20],
    ]);
  });

  test('drops notes, poly pressure, All Sound Off, All Notes Off and real-time bytes', () => {
    expect(
      body(
        sequence(
          [0x90, 60, 100],
          [0xa0, 60, 40],
          [0x80, 60, 0],
          [0xb0, 120, 0],
          [0xb0, 123, 0],
          [0xf8],
          [0xfa],
        ),
      ),
    ).toEqual([]);
  });

  test('ignores messages at or after startIndex', () => {
    expect(body(sequence([0xb0, 7, 100], [0xb0, 7, 64]), 1)).toEqual([[0xb0, 7, 100]]);
  });

  test('keeps the relative order of surviving messages', () => {
    expect(body(sequence([0xb0, 7, 100], [0xe0, 0, 64], [0xb0, 10, 64], [0xb0, 7, 64]))).toEqual([
      [0xe0, 0, 64],
      [0xb0, 10, 64],
      [0xb0, 7, 64],
    ]);
  });

  test('reuses the original message objects', () => {
    const messages = sequence([0xb0, 7, 100]);
    expect(emitChaseMessages(reduceChaseState(messages, 1)).at(-1)).toBe(messages[0]!);
  });
});

describe('chase system exclusive', () => {
  test('keeps every SysEx in order without deduplication', () => {
    const partMode = [0xf0, 0x43, 0x10, 0x4c, 0x08, 0x00, 0x07, 0x01, 0xf7];
    expect(body(sequence(partMode, [0xb0, 7, 100], partMode))).toEqual([
      partMode,
      [0xb0, 7, 100],
      partMode,
    ]);
  });
});
