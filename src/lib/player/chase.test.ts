import { describe, expect, test } from 'bun:test';
import { collectChaseMessages, isResetSysex } from './chase.ts';
import type { PlaybackMidiMessage } from '../smf/playback.ts';

const PRELUDE = Array.from({ length: 16 }, (_, channel) => [0xb0 | channel, 121, 0]);
const GM_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
const GM_SYSTEM_OFF = [0xf0, 0x7e, 0x7f, 0x09, 0x02, 0xf7];
const GM2_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7];
const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
const XG_ALL_PARAMETER_RESET = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7f, 0x00, 0xf7];
const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
const GS_SYSTEM_MODE_SET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x00, 0x00, 0x7f, 0x00, 0x01, 0xf7];
const XG_PART_MODE = [0xf0, 0x43, 0x10, 0x4c, 0x08, 0x09, 0x07, 0x02, 0xf7];
const XG_MASTER_VOLUME = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x04, 0x7f, 0xf7];
const UNIVERSAL_MASTER_VOLUME = [0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x7f, 0xf7];

function sequence(...datas: number[][]): PlaybackMidiMessage[] {
  return datas.map((data, index) => ({ tick: index * 120, seconds: index * 0.125, data }));
}

function fold(messages: PlaybackMidiMessage[], startIndex = messages.length): number[][] {
  return collectChaseMessages(messages, startIndex).map((message) => message.data);
}

function body(messages: PlaybackMidiMessage[], startIndex = messages.length): number[][] {
  return fold(messages, startIndex).slice(PRELUDE.length);
}

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
    expect(collectChaseMessages(messages, 1).at(-1)).toBe(messages[0]!);
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

describe('chase bank and program', () => {
  test('emits the bank that was pending when the program changed, right before it', () => {
    expect(body(sequence([0xb0, 0, 127], [0xb0, 32, 0], [0xc0, 1]))).toEqual([
      [0xb0, 0, 127],
      [0xb0, 32, 0],
      [0xc0, 1],
    ]);
  });

  test('keeps the captured bank when the bank changes after the program', () => {
    expect(body(sequence([0xb0, 0, 127], [0xc0, 1], [0xb0, 0, 0]))).toEqual([
      [0xb0, 0, 127],
      [0xc0, 1],
      [0xb0, 0, 0],
    ]);
  });

  test('keeps only the last program per channel with its own bank', () => {
    expect(body(sequence([0xb0, 0, 0], [0xc0, 1], [0xb0, 0, 8], [0xc0, 2]))).toEqual([
      [0xb0, 0, 8],
      [0xc0, 2],
    ]);
  });

  test('emits a program without bank, and a bank without program', () => {
    expect(body(sequence([0xc0, 5], [0xb1, 32, 3]))).toEqual([
      [0xc0, 5],
      [0xb1, 32, 3],
    ]);
  });

  test('emits only the bank byte that was set', () => {
    expect(body(sequence([0xb0, 32, 2], [0xc0, 9]))).toEqual([
      [0xb0, 32, 2],
      [0xc0, 9],
    ]);
  });
});

describe('chase RPN and NRPN', () => {
  test('a typical pitch bend range block comes out unchanged', () => {
    const block = [
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ];
    expect(body(sequence(...block))).toEqual(block);
  });

  test('keeps the last data entry per parameter, each with its selection, and restores the final selection', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 6, 12], [0xb0, 38, 5])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 12],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 38, 5],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('keeps the last write per controller in the order they were written', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 1], [0xb0, 6, 2], [0xb0, 38, 5], [0xb0, 6, 3])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 1],
      [0xb0, 38, 5],
      [0xb0, 101, 0],
      [0xb0, 100, 1],
      [0xb0, 6, 3],
      [0xb0, 101, 0],
      [0xb0, 100, 1],
    ]);
  });

  test('keeps increment and decrement in order after an absolute write', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 96, 0], [0xb0, 97, 0])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 96, 0],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 97, 0],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('drops a relative operation without an absolute write', () => {
    expect(body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 96, 0]))).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('drops a relative operation based only on Data Entry LSB', () => {
    expect(body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 38, 5], [0xb0, 96, 0]))).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 38, 5],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('keeps a relative operation after Data Entry LSB when Data Entry MSB is present', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 38, 5], [0xb0, 96, 0])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 38, 5],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 96, 0],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('collapses repeated Data Entry LSB writes when a relative operation between them is dropped', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 38, 5], [0xb0, 96, 0], [0xb0, 38, 7])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 38, 7],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('keeps each data write at its own position among other messages', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb1, 7, 100], [0xb0, 38, 5])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb1, 7, 100],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 38, 5],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('handles NRPN separately from RPN and restores the inactive registers first', () => {
    expect(
      body(
        sequence(
          [0xb0, 101, 0],
          [0xb0, 100, 0],
          [0xb0, 6, 2],
          [0xb0, 99, 1],
          [0xb0, 98, 8],
          [0xb0, 6, 64],
        ),
      ),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 99, 1],
      [0xb0, 98, 8],
      [0xb0, 6, 64],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 99, 1],
      [0xb0, 98, 8],
    ]);
  });

  test('drops data entry while no parameter or the null parameter is selected', () => {
    expect(body(sequence([0xb0, 6, 2], [0xb0, 101, 127], [0xb0, 100, 127], [0xb0, 6, 3]))).toEqual([
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ]);
  });

  test('drops data entry while only one register byte of the selection is set', () => {
    expect(body(sequence([0xb0, 101, 0], [0xb0, 6, 2]))).toEqual([[0xb0, 101, 0]]);
  });

  test('moves a superseded write to the position of its last value', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 7, 100], [0xb0, 6, 4])),
    ).toEqual([
      [0xb0, 7, 100],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 4],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('keeps the selection per channel', () => {
    expect(body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb1, 6, 2]))).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });
});

describe('chase Reset All Controllers in the file', () => {
  test('forgets the controllers it resets and keeps the others', () => {
    expect(
      body(
        sequence(
          [0xb0, 1, 100],
          [0xb0, 7, 90],
          [0xb0, 64, 127],
          [0xe0, 0, 0],
          [0xd0, 50],
          [0xb0, 121, 0],
          [0xb0, 11, 80],
        ),
      ),
    ).toEqual([
      [0xb0, 7, 90],
      [0xb0, 11, 80],
    ]);
  });

  test('resets exactly the XG set and leaves legato and hold 2 alone', () => {
    const targets = [1, 11, 64, 65, 66, 67, 84].map((controller) => [0xb0, controller, 1]);
    expect(body(sequence(...targets, [0xb0, 68, 1], [0xb0, 69, 1], [0xb0, 121, 0]))).toEqual([
      [0xb0, 68, 1],
      [0xb0, 69, 1],
    ]);
  });

  test('keeps the parameter values but ends with the null selection so a data entry right after the seek is ignored', () => {
    expect(body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 121, 0]))).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ]);
  });

  test('ends with the null selection of every kind it re-sent', () => {
    expect(
      body(
        sequence(
          [0xb0, 99, 1],
          [0xb0, 98, 8],
          [0xb0, 6, 64],
          [0xb0, 101, 0],
          [0xb0, 100, 0],
          [0xb0, 6, 2],
          [0xb0, 121, 0],
        ),
      ),
    ).toEqual([
      [0xb0, 99, 1],
      [0xb0, 98, 8],
      [0xb0, 6, 64],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
      [0xb0, 99, 127],
      [0xb0, 98, 127],
    ]);
  });

  test('restores a selection made after the reset and nulls the other kind it re-sent', () => {
    expect(
      body(
        sequence(
          [0xb0, 99, 1],
          [0xb0, 98, 8],
          [0xb0, 6, 64],
          [0xb0, 121, 0],
          [0xb0, 101, 0],
          [0xb0, 100, 0],
          [0xb0, 6, 2],
        ),
      ),
    ).toEqual([
      [0xb0, 99, 1],
      [0xb0, 98, 8],
      [0xb0, 6, 64],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 99, 127],
      [0xb0, 98, 127],
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ]);
  });

  test('fills the untouched half of a selection made after the reset with null', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2], [0xb0, 121, 0], [0xb0, 101, 0])),
    ).toEqual([
      [0xb0, 101, 0],
      [0xb0, 100, 0],
      [0xb0, 6, 2],
      [0xb0, 101, 0],
      [0xb0, 100, 127],
    ]);
  });

  test('keeps bank and program', () => {
    expect(body(sequence([0xb0, 0, 127], [0xc0, 1], [0xb0, 121, 0]))).toEqual([
      [0xb0, 0, 127],
      [0xc0, 1],
    ]);
  });

  test('resets only its own channel', () => {
    expect(body(sequence([0xb1, 1, 100], [0xb0, 121, 0]))).toEqual([[0xb1, 1, 100]]);
  });
});

const RESET_SYSEX: [string, number[]][] = [
  ['GM System On', GM_SYSTEM_ON],
  ['GM System Off', GM_SYSTEM_OFF],
  ['GM2 System On', GM2_SYSTEM_ON],
  ['XG System On', XG_SYSTEM_ON],
  ['XG All Parameter Reset', XG_ALL_PARAMETER_RESET],
  ['GS Reset', GS_RESET],
  ['GS System Mode Set', GS_SYSTEM_MODE_SET],
  ['XG System On for device 2', [0xf0, 0x43, 0x12, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]],
];

const NON_RESET_SYSEX: [string, number[]][] = [
  ['XG part mode', XG_PART_MODE],
  ['XG master volume', XG_MASTER_VOLUME],
  ['universal master volume', UNIVERSAL_MASTER_VOLUME],
  ['an XG bulk dump header', [0xf0, 0x43, 0x00, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]],
];

describe('isResetSysex', () => {
  test.each(RESET_SYSEX)('recognizes %s', (_, data) => {
    expect(isResetSysex(data)).toBe(true);
  });

  test.each(NON_RESET_SYSEX)('does not treat %s as a reset', (_, data) => {
    expect(isResetSysex(data)).toBe(false);
  });
});

describe('chase reset SysEx', () => {
  test('drops the state and SysEx before a reset and puts the reset first', () => {
    expect(
      body(sequence([0xb0, 7, 100], XG_PART_MODE, [0xc0, 1], XG_SYSTEM_ON, [0xb0, 7, 64])),
    ).toEqual([XG_SYSTEM_ON, [0xb0, 7, 64]]);
  });

  test('keeps only the last reset', () => {
    expect(body(sequence(GM_SYSTEM_ON, XG_SYSTEM_ON))).toEqual([XG_SYSTEM_ON]);
  });

  test('keeps the prelude before the reset', () => {
    expect(fold(sequence(XG_SYSTEM_ON))).toEqual([...PRELUDE, XG_SYSTEM_ON]);
  });

  test('drops the RPN selection and bank before a reset', () => {
    expect(
      body(sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 0, 127], [0xc0, 1], GM_SYSTEM_ON)),
    ).toEqual([GM_SYSTEM_ON]);
  });

  test('keeps state that comes after the reset on every channel', () => {
    expect(body(sequence([0xb1, 7, 1], XG_SYSTEM_ON, [0xb1, 7, 2], [0xb2, 10, 3]))).toEqual([
      XG_SYSTEM_ON,
      [0xb1, 7, 2],
      [0xb2, 10, 3],
    ]);
  });
});

describe('collectChaseMessages size', () => {
  test('does not grow with the number of messages before the seek position', () => {
    const bends = Array.from({ length: 5000 }, (_, i) => [0xe0, i & 0x7f, (i >> 7) & 0x7f]);
    expect(body(sequence(...bends))).toEqual([bends.at(-1)!]);
  });

  test('bounds a dense automation file to the prelude plus one message per state slot', () => {
    const datas: number[][] = [];
    for (let i = 0; i < 2000; i += 1) {
      datas.push([0xb0 | (i % 16), 11, i & 0x7f], [0xe0 | (i % 16), i & 0x7f, 0x40]);
    }
    expect(fold(sequence(...datas))).toHaveLength(16 + 16 + 16);
  });

  test('keeps repeated absolute and relative data operations', () => {
    const datas: number[][] = [
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ];
    for (let i = 0; i < 1000; i += 1) datas.push([0xb0, 6, 2], [0xb0, 96, 0]);
    expect(body(sequence(...datas))).toHaveLength(6002);
  });

  test('handles many relative operations on one parameter', () => {
    const messages = sequence([0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 2]);
    for (let i = 0; i < 200_000; i += 1) {
      const index = messages.length;
      messages.push({ tick: index * 120, seconds: index * 0.125, data: [0xb0, 96, 0] });
    }
    expect(body(messages)).toHaveLength(600_005);
  });

  test('collapses repeated absolute data operations to one write', () => {
    const datas: number[][] = [
      [0xb0, 101, 0],
      [0xb0, 100, 0],
    ];
    for (let i = 0; i < 1000; i += 1) datas.push([0xb0, 6, 2]);
    expect(body(sequence(...datas))).toHaveLength(5);
  });

  test('keeps every SysEx after the last reset and drops every SysEx before it', () => {
    const parameterChanges = Array.from({ length: 50 }, (_, i) => [
      0xf0,
      0x43,
      0x10,
      0x4c,
      0x08,
      i % 16,
      0x0b,
      0x40 + (i % 32),
      0xf7,
    ]);
    expect(body(sequence(...parameterChanges, XG_SYSTEM_ON))).toEqual([XG_SYSTEM_ON]);
    expect(body(sequence(XG_SYSTEM_ON, ...parameterChanges))).toEqual([
      XG_SYSTEM_ON,
      ...parameterChanges,
    ]);
  });
});
