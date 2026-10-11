import { describe, expect, test } from 'bun:test';
import { XgDrumKitFallback, withXgDrumKitFallback } from './xgDrumKitFallback.ts';

const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
const XG_ALL_PARAMETER_RESET = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7f, 0x00, 0xf7];
const GM_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
const GM_SYSTEM_OFF = [0xf0, 0x7e, 0x7f, 0x09, 0x02, 0xf7];
const GM2_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7];
const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
const GS_SYSTEM_MODE_SET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x00, 0x00, 0x7f, 0x00, 0x01, 0xf7];
const XG_PART_MODE = [0xf0, 0x43, 0x10, 0x4c, 0x08, 0x09, 0x07, 0x02, 0xf7];

const NON_XG_RESETS: [string, number[]][] = [
  ['GM System On', GM_SYSTEM_ON],
  ['GM System Off', GM_SYSTEM_OFF],
  ['GM2 System On', GM2_SYSTEM_ON],
  ['GS Reset', GS_RESET],
  ['GS System Mode Set', GS_SYSTEM_MODE_SET],
];

const XG_RESETS: [string, number[]][] = [
  ['XG System On', XG_SYSTEM_ON],
  ['XG All Parameter Reset', XG_ALL_PARAMETER_RESET],
  ['XG System On for device 2', [0xf0, 0x43, 0x12, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]],
];

function run(messages: number[][], fallback = enabledFallback()): number[][] {
  return messages.map((data) => [...fallback.apply(data)]);
}

function enabledFallback(): XgDrumKitFallback {
  const fallback = new XgDrumKitFallback();
  fallback.enabled = true;
  return fallback;
}

function programs(messages: number[][]): number[][] {
  return messages.filter((data) => (data[0]! & 0xf0) === 0xc0);
}

describe('XgDrumKitFallback', () => {
  test('replaces an undefined kit with the last defined kit in XG mode', () => {
    const out = run([XG_SYSTEM_ON, [0xb9, 0, 127], [0xc9, 16], [0xc9, 86], [0xc9, 112]]);
    expect(programs(out)).toEqual([
      [0xc9, 16],
      [0xc9, 16],
      [0xc9, 16],
    ]);
  });

  test('falls back to the Standard Kit after a reset, without a bank select on channel 10', () => {
    expect(programs(run([XG_SYSTEM_ON, [0xc9, 86]]))).toEqual([[0xc9, 0]]);
    expect(
      programs(run([XG_SYSTEM_ON, [0xb9, 0, 127], [0xc9, 16], XG_SYSTEM_ON, [0xc9, 86]])),
    ).toEqual([
      [0xc9, 16],
      [0xc9, 0],
    ]);
  });

  test('replaces an undefined kit on a melodic part with the Standard Kit', () => {
    const out = run([XG_SYSTEM_ON, [0xc8, 52], [0xb8, 0, 127], [0xb8, 32, 0], [0xc8, 112]]);
    expect(programs(out)).toEqual([
      [0xc8, 52],
      [0xc8, 0],
    ]);
  });

  test('remembers the last defined kit per channel', () => {
    const out = run([
      XG_SYSTEM_ON,
      [0xb8, 0, 127],
      [0xb9, 0, 127],
      [0xc8, 25],
      [0xc9, 40],
      [0xc8, 86],
      [0xc9, 86],
    ]);
    expect(programs(out)).toEqual([
      [0xc8, 25],
      [0xc9, 40],
      [0xc8, 25],
      [0xc9, 40],
    ]);
  });

  test('keeps programs outside bank 127 unchanged', () => {
    const messages = [
      XG_SYSTEM_ON,
      [0xc0, 86],
      [0xb0, 0, 64],
      [0xc0, 86],
      [0xb0, 0, 126],
      [0xc0, 5],
      [0xb9, 0, 0],
      [0xc9, 86],
    ];
    expect(run(messages)).toEqual(messages);
  });

  test('ignores the bank LSB', () => {
    expect(programs(run([XG_SYSTEM_ON, [0xb9, 0, 127], [0xb9, 32, 5], [0xc9, 86]]))).toEqual([
      [0xc9, 0],
    ]);
  });

  test.each(NON_XG_RESETS)('keeps undefined kits unchanged after %s', (_, reset) => {
    const messages = [reset, [0xb9, 0, 127], [0xc9, 86]];
    expect(run(messages)).toEqual(messages);
    const afterXg = [XG_SYSTEM_ON, reset, [0xb9, 0, 127], [0xc9, 86]];
    expect(run(afterXg)).toEqual(afterXg);
  });

  test('keeps undefined kits unchanged before any reset', () => {
    const messages = [
      [0xb9, 0, 127],
      [0xc9, 86],
    ];
    expect(run(messages)).toEqual(messages);
  });

  test.each(XG_RESETS)('enters XG mode on %s', (_, reset) => {
    expect(programs(run([reset, [0xc9, 86]]))).toEqual([[0xc9, 0]]);
  });

  test('XG System On for a song without its own reset makes channel 10 fall back', () => {
    expect(programs(run([GM_SYSTEM_ON, XG_SYSTEM_ON, [0xc9, 56], [0xc9, 127]]))).toEqual([
      [0xc9, 0],
      [0xc9, 0],
    ]);
  });

  test('resets the bank select on a reset', () => {
    const messages = [XG_SYSTEM_ON, [0xb0, 0, 127], XG_SYSTEM_ON, [0xc0, 86]];
    expect(run(messages)).toEqual(messages);
  });

  test('passes other messages through', () => {
    const messages = [
      XG_SYSTEM_ON,
      [0x99, 36, 100],
      [0x89, 36, 0],
      [0xb9, 7, 100],
      XG_PART_MODE,
      [0xe9, 0, 64],
      [0xd9, 10],
      [0xf8],
    ];
    expect(run(messages)).toEqual(messages);
  });

  test('tracks state while disabled', () => {
    const fallback = new XgDrumKitFallback();
    expect(run([XG_SYSTEM_ON, [0xb9, 0, 127], [0xc9, 16], [0xc9, 86]], fallback)).toEqual([
      XG_SYSTEM_ON,
      [0xb9, 0, 127],
      [0xc9, 16],
      [0xc9, 86],
    ]);
    fallback.enabled = true;
    expect(run([[0xc9, 112]], fallback)).toEqual([[0xc9, 16]]);
  });
});

describe('withXgDrumKitFallback', () => {
  function setup() {
    const calls: { data: number[]; channelOffset?: number; time?: number }[] = [];
    const fallback = enabledFallback();
    const synth = withXgDrumKitFallback(
      {
        sendMessage: (message, channelOffset, eventOptions) => {
          calls.push({ data: Array.from(message), channelOffset, time: eventOptions?.time });
        },
      },
      fallback,
    );
    return { synth, calls };
  }

  test('sends the rewritten message with the same channel offset and time', () => {
    const { synth, calls } = setup();
    synth.sendMessage(XG_SYSTEM_ON, 0, { time: 1 });
    synth.sendMessage([0xc9, 86], 0, { time: 2 });
    expect(calls).toEqual([
      { data: XG_SYSTEM_ON, channelOffset: 0, time: 1 },
      { data: [0xc9, 0], channelOffset: 0, time: 2 },
    ]);
  });

  test('passes messages without a time unchanged', () => {
    const { synth, calls } = setup();
    synth.sendMessage([0xb9, 120, 0]);
    expect(calls).toEqual([{ data: [0xb9, 120, 0], channelOffset: undefined, time: undefined }]);
  });
});
