import { describe, expect, test } from 'bun:test';
import {
  MOMENTUM_TIME_CONSTANT_MS,
  momentumOffset,
  momentumSpeed,
  releaseVelocity,
} from './momentum.ts';

describe('releaseVelocity', () => {
  test('measures a steady drag in pixels per millisecond', () => {
    const samples = [0, 16, 32, 48, 64].map((t) => ({ t, x: 2 * t, y: -t }));
    const v = releaseVelocity(samples, 64);
    expect(v.vx).toBeCloseTo(2, 9);
    expect(v.vy).toBeCloseTo(-1, 9);
  });

  test('uses only the last 100 ms before the release', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 1000, y: 0 },
      { t: 150, x: 1050, y: 0 },
      { t: 200, x: 1100, y: 0 },
    ];
    expect(releaseVelocity(samples, 200).vx).toBeCloseTo(1, 9);
  });

  test('is zero when the pointer rested before the release', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 16, x: 50, y: 0 },
    ];
    expect(releaseVelocity(samples, 100)).toEqual({ vx: 0, vy: 0 });
  });

  test('is zero without two samples to compare', () => {
    expect(releaseVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ t: 0, x: 10, y: 10 }], 0)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('momentumOffset', () => {
  test('starts at the release speed and settles at speed times the time constant', () => {
    expect(momentumOffset(2, 0)).toBe(0);
    expect(momentumOffset(2, 1) / 1).toBeCloseTo(2, 2);
    expect(momentumOffset(2, 100 * MOMENTUM_TIME_CONSTANT_MS)).toBeCloseTo(
      2 * MOMENTUM_TIME_CONSTANT_MS,
      6,
    );
  });

  test('travels in the direction of the release', () => {
    expect(momentumOffset(-1.5, 200)).toBeLessThan(0);
  });
});

describe('momentumSpeed', () => {
  test('decays by a factor of e every time constant', () => {
    expect(momentumSpeed(3, MOMENTUM_TIME_CONSTANT_MS)).toBeCloseTo(3 / Math.E, 9);
  });
});
