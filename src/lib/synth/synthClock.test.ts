import { describe, expect, test } from 'bun:test';
import { SynthClockOffset, withClockOffset } from './synthClock.ts';

describe('SynthClockOffset', () => {
  test('is zero before any observation', () => {
    expect(new SynthClockOffset().seconds).toBe(0);
  });

  test('keeps the smallest observed lag', () => {
    const offset = new SynthClockOffset();
    offset.observe(1.08, 1.0);
    offset.observe(2.075, 2.0);
    offset.observe(3.09, 3.0);
    expect(offset.seconds).toBeCloseTo(0.075, 9);
  });

  test('never goes below zero', () => {
    const offset = new SynthClockOffset();
    offset.observe(1.0, 1.003);
    expect(offset.seconds).toBe(0);
  });
});

describe('withClockOffset', () => {
  function setup(offsetSeconds: number) {
    const calls: { data: number[]; channelOffset?: number; time?: number }[] = [];
    const synth = withClockOffset(
      {
        sendMessage: (message, channelOffset, eventOptions) => {
          calls.push({ data: Array.from(message), channelOffset, time: eventOptions?.time });
        },
      },
      { seconds: offsetSeconds },
    );
    return { synth, calls };
  }

  test('shifts scheduled times into the synth clock', () => {
    const { synth, calls } = setup(0.075);
    synth.sendMessage([0x90, 60, 100], 0, { time: 10 });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.data).toEqual([0x90, 60, 100]);
    expect(call!.channelOffset).toBe(0);
    expect(call!.time).toBeCloseTo(9.925, 9);
  });

  test('passes messages without a time unchanged', () => {
    const { synth, calls } = setup(0.075);
    synth.sendMessage([0x80, 60, 0]);
    expect(calls).toEqual([{ data: [0x80, 60, 0], channelOffset: undefined, time: undefined }]);
  });

  test('reads the offset at send time', () => {
    const offset = { seconds: 0 };
    const times: (number | undefined)[] = [];
    const synth = withClockOffset(
      { sendMessage: (_message, _channelOffset, eventOptions) => times.push(eventOptions?.time) },
      offset,
    );
    synth.sendMessage([0x90, 60, 100], 0, { time: 5 });
    offset.seconds = 0.1;
    synth.sendMessage([0x90, 60, 100], 0, { time: 5 });
    expect(times[0]).toBe(5);
    expect(times[1]).toBeCloseTo(4.9, 9);
  });
});
