import { describe, expect, test } from 'bun:test';
import { HiddenLatencyMeter } from './hiddenLatency.ts';

function observeSteady(meter: HiddenLatencyMeter, fromSeconds: number, toSeconds: number) {
  for (let t = fromSeconds; t <= toSeconds + 1e-9; t += 0.05) meter.observe(t, t + 10, true);
}

describe('HiddenLatencyMeter', () => {
  test('stays at zero while the audio clock keeps pace with the wall clock', () => {
    const meter = new HiddenLatencyMeter();

    observeSteady(meter, 0, 5);

    expect(meter.seconds).toBe(0);
  });

  test('counts the audio time rendered in a burst after a freeze', () => {
    const meter = new HiddenLatencyMeter();
    observeSteady(meter, 0, 1);

    for (let i = 1; i <= 20; i += 1) meter.observe(1 + i * 0.05, 11, true);
    meter.observe(2.03, 11.96, true);
    for (let i = 1; i <= 20; i += 1) meter.observe(2.03 + i * 0.05, 11.96 + i * 0.05, true);

    expect(meter.seconds).toBeCloseTo(0.93, 6);
  });

  test('keeps the largest burst of separate freezes', () => {
    const meter = new HiddenLatencyMeter();
    meter.observe(0, 10, true);
    meter.observe(0.05, 10.95, true);
    meter.observe(0.1, 11, true);
    meter.observe(0.15, 11.3, true);
    meter.observe(0.2, 11.35, true);
    expect(meter.seconds).toBeCloseTo(0.9, 6);

    meter.observe(0.25, 12.4, true);
    meter.observe(0.3, 12.45, true);

    expect(meter.seconds).toBeCloseTo(1, 6);
  });

  test('adds up a burst that spans consecutive observations', () => {
    const meter = new HiddenLatencyMeter();
    meter.observe(0, 10, true);
    meter.observe(0.05, 10.3, true);
    meter.observe(0.1, 10.95, true);
    meter.observe(0.15, 11, true);

    expect(meter.seconds).toBeCloseTo(0.85, 6);
  });

  test('ignores the jitter of a clock that advances in coarse steps', () => {
    const meter = new HiddenLatencyMeter();
    meter.observe(0, 10, true);
    meter.observe(0.05, 10.09, true);
    meter.observe(0.1, 10.1, true);

    expect(meter.seconds).toBe(0);
  });

  test('does not compare across a period in which the clock was not running', () => {
    const meter = new HiddenLatencyMeter();
    meter.observe(0, 10, true);
    meter.observe(0.05, 10.05, false);
    meter.observe(0.1, 10.6, true);
    meter.observe(0.15, 10.65, true);

    expect(meter.seconds).toBe(0);
  });
});
