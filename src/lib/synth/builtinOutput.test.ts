import { describe, expect, test } from 'bun:test';
import { BuiltinSynthOutput, STALL_THRESHOLD_SECONDS, toContextTime } from './builtinOutput.ts';

interface ClockState {
  currentTime: number;
  state: string;
  outputLatency?: number;
  baseLatency?: number;
}

function setupOutput(clockInit: Partial<ClockState> = {}) {
  const calls: { data: number[]; time: number }[] = [];
  const gainCalls: string[] = [];
  const clock: ClockState = { currentTime: 10, state: 'running', ...clockInit };
  let nowMs = 1000;
  const stallTimes: number[] = [];
  const output = new BuiltinSynthOutput({
    synth: {
      sendMessage: (message, _channelOffset, eventOptions) => {
        calls.push({ data: Array.from(message), time: eventOptions?.time ?? -1 });
      },
    },
    clock,
    gain: {
      cancelScheduledValues: (t) => gainCalls.push(`cancel ${t}`),
      setValueAtTime: (v, t) => gainCalls.push(`set ${v} ${t}`),
    },
    now: () => nowMs,
    onStall: (stalledAtMs) => {
      stallTimes.push(stalledAtMs);
    },
  });
  return {
    output,
    calls,
    gainCalls,
    clock,
    setNow(ms: number) {
      nowMs = ms;
    },
    stallTimes,
    stalls: () => stallTimes.length,
  };
}

const isPanic = (c: { data: number[] }) =>
  (c.data[0]! & 0xf0) === 0xb0 && (c.data[1] === 120 || c.data[1] === 123);

describe('toContextTime', () => {
  test('adds the anchor to the timestamp in seconds', () => {
    expect(toContextTime(1500, 9)).toBeCloseTo(10.5, 9);
  });
});

describe('BuiltinSynthOutput', () => {
  test('drops messages until activated', () => {
    const { output, calls, stalls } = setupOutput();
    output.send([0x90, 60, 100], 1000);
    expect(calls).toEqual([]);
    expect(stalls()).toBe(0);
    expect(output.isActive).toBe(false);
  });

  test('activate() with nothing queued maps timestamps from the current audio time', () => {
    const { output, calls, gainCalls } = setupOutput();

    output.activate();

    expect(calls).toHaveLength(32);
    expect(calls.every((c) => isPanic(c) && c.time === 10)).toBe(true);
    expect(gainCalls).toEqual(['cancel 10', 'set 1 10']);
    output.send([0x90, 60, 100], 1020);
    expect(calls.at(-1)!.data).toEqual([0x90, 60, 100]);
    expect(calls.at(-1)!.time).toBeCloseTo(10.02, 9);
    expect(output.latencyMs()).toBe(0);
  });

  test('drops messages and reports a stall once when the context is not running', () => {
    const { output, calls, clock, stalls, stallTimes } = setupOutput();
    output.activate();
    const before = calls.length;
    clock.state = 'suspended';

    output.send([0x90, 60, 100], 1010);
    output.send([0x80, 60, 0], 1020);

    expect(calls).toHaveLength(before);
    expect(stalls()).toBe(1);
    expect(stallTimes[0]).toBeCloseTo(1000, 6);
    expect(output.isActive).toBe(false);
  });

  test('mutes the output as soon as a stall is detected', () => {
    const { output, gainCalls, clock } = setupOutput();
    output.activate();
    gainCalls.length = 0;
    clock.state = 'suspended';

    output.send([0x80, 60, 0], 1010);

    expect(gainCalls).toEqual(['cancel 10', 'set 0 10']);
  });

  test('detects a frozen audio clock even while the state still says running', () => {
    const { output, calls, stalls, stallTimes, setNow } = setupOutput();
    output.activate();

    setNow(1200);
    output.send([0x90, 60, 100], 1200);
    expect(calls.at(-1)!.data).toEqual([0x90, 60, 100]);
    expect(stalls()).toBe(0);

    setNow(1000 + STALL_THRESHOLD_SECONDS * 1000 + 50);
    output.send([0x80, 60, 0], 1000 + STALL_THRESHOLD_SECONDS * 1000 + 50);
    expect(calls.at(-1)!.data).toEqual([0x90, 60, 100]);
    expect(stalls()).toBe(1);
    expect(stallTimes[0]).toBeCloseTo(1000, 6);
  });

  test('activate() after a stall mutes the leftover queue and starts new messages after it', () => {
    const { output, calls, gainCalls, clock, setNow } = setupOutput({ outputLatency: 0.02 });
    output.activate();
    output.send([0x90, 60, 100], 1040);
    clock.state = 'suspended';
    output.send([0x80, 60, 0], 1100);

    clock.state = 'running';
    clock.currentTime = 10.01;
    setNow(5000);
    gainCalls.length = 0;
    const before = calls.length;

    output.activate();

    expect(gainCalls).toEqual(['cancel 10.01', 'set 0 10.01', 'set 1 10.04']);
    const panics = calls.slice(before).filter(isPanic);
    expect(panics).toHaveLength(32);
    expect(panics.every((c) => Math.abs(c.time - 10.04) < 1e-9)).toBe(true);
    output.send([0x90, 62, 100], 5000);
    expect(calls.at(-1)!.time).toBeCloseTo(10.04, 9);
    expect(output.latencyMs()).toBeCloseTo(50, 6);
  });

  test('does not treat the anchor lead after a resume as a frozen clock', () => {
    const { output, clock, stalls, setNow } = setupOutput();
    output.activate();
    output.send([0x90, 60, 100], 1240);
    clock.state = 'suspended';
    output.notifyStateChange();
    clock.state = 'running';
    clock.currentTime = 10.005;
    setNow(5000);
    output.activate();

    output.send([0x90, 62, 100], 5000);
    output.send([0x80, 62, 0], 5045);
    output.checkClock();

    expect(stalls()).toBe(1);
    expect(output.isActive).toBe(true);

    setNow(5300);
    output.checkClock();
    expect(stalls()).toBe(2);
  });

  test('resets the synth on the next activate() after a stall', () => {
    const { output, calls, clock } = setupOutput();
    output.activate();
    clock.state = 'suspended';
    output.notifyStateChange();
    clock.state = 'running';
    const before = calls.length;

    output.activate();

    expect(
      calls
        .slice(before)
        .filter((c) => c.data[0] === 0xf0)
        .map((c) => c.data),
    ).toEqual([
      [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
      [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
    ]);
  });

  test('does not reset the synth on activate() without a stall', () => {
    const { output, calls } = setupOutput();
    output.activate();
    output.activate();

    expect(calls.some((c) => c.data[0] === 0xf0)).toBe(false);
  });

  test('checkClock() detects a frozen audio clock without any message', () => {
    const { output, stalls, stallTimes, setNow } = setupOutput();
    output.checkClock();
    expect(stalls()).toBe(0);
    output.activate();

    setNow(1200);
    output.checkClock();
    expect(stalls()).toBe(0);

    setNow(1300);
    output.checkClock();
    expect(stalls()).toBe(1);
    expect(stallTimes[0]).toBeCloseTo(1000, 6);
  });

  test('notifyStateChange() reports a stall only while active', () => {
    const { output, clock, stalls } = setupOutput();
    clock.state = 'interrupted';
    output.notifyStateChange();
    expect(stalls()).toBe(0);

    clock.state = 'running';
    output.activate();
    clock.state = 'interrupted';
    output.notifyStateChange();
    output.notifyStateChange();
    expect(stalls()).toBe(1);
  });

  test('latencyMs() falls back from outputLatency to baseLatency to 0', () => {
    expect(setupOutput({ outputLatency: 0.03, baseLatency: 0.01 }).output.latencyMs()).toBeCloseTo(
      30,
      6,
    );
    expect(setupOutput({ baseLatency: 0.01 }).output.latencyMs()).toBeCloseTo(10, 6);
    expect(setupOutput().output.latencyMs()).toBe(0);
  });
});
