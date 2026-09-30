import { describe, expect, test } from 'bun:test';
import {
  DB_PER_DOUBLING_PER_AMOUNT,
  commonShiftDb,
  drumVelocity,
  drumVelocityRatio,
  errorStats,
  meanDifference,
  meetsCriteria,
  pairPoints,
  pointsAt,
  residualDb,
  slopePerDoubling,
  voiceVelocity,
  voiceVelocityDelta,
} from './fit.ts';
import type { Point } from './fit.ts';

const line = (velocities: number[], slope: number, offset = 0) =>
  velocities.map((velocity) => ({ velocity, level: offset + slope * Math.log2(velocity / 64) }));

const points = (
  velocities: number[],
  referenceSlope: number,
  measuredSlope: number,
  gap = 0,
): Point[] =>
  velocities.map((velocity) => ({
    velocity,
    reference: gap + referenceSlope * Math.log2(velocity / 64),
    measured: measuredSlope * Math.log2(velocity / 64),
  }));

describe('pairPoints', () => {
  test('keeps points that both sides measured at -80 dB or above', () => {
    const reference = { '24': -85, '32': -30, '48': -30, '64': -20, '96': null, '127': -10 };
    const measured = { '24': -40, '32': -35, '48': -81, '64': null, '96': -20, '127': Number.NaN };
    expect(pairPoints(reference, measured, drumVelocity)).toEqual([
      { velocity: 32, reference: -30, measured: -35 },
    ]);
    expect(pairPoints({ '60/100': -10 }, {}, voiceVelocity)).toEqual([]);
    expect(voiceVelocity('60/100')).toBe(100);
  });
});

describe('pointsAt', () => {
  test('keeps the chosen points even below -80 dB', () => {
    expect(pointsAt({ '32': -30 }, { '32': -95 }, ['32'], drumVelocity, 'drum 0/36')).toEqual([
      { velocity: 32, reference: -30, measured: -95 },
    ]);
  });

  test('stops when a chosen point can no longer be measured', () => {
    expect(() =>
      pointsAt({ '32': -30 }, { '32': null }, ['32'], drumVelocity, 'drum 0/36'),
    ).toThrow('drum 0/36 point 32 can no longer be measured');
  });
});

describe('slopePerDoubling', () => {
  test('fits dB per doubling of velocity', () => {
    expect(slopePerDoubling(line([32, 64, 127], 9))).toBeCloseTo(9, 6);
  });

  test('needs three different velocities', () => {
    expect(slopePerDoubling(line([64, 127], 9))).toBeNull();
    expect(
      slopePerDoubling([...line([64], 9), ...line([64], 9, 3), ...line([64], 9, 6)]),
    ).toBeNull();
  });
});

describe('drumVelocityRatio', () => {
  test('divides the reference slope by the measured slope within 0.3 to 1.3', () => {
    expect(drumVelocityRatio(points([32, 64, 96, 127], 9, 10))).toBeCloseTo(0.9, 6);
    expect(drumVelocityRatio(points([32, 64, 96, 127], 20, 10))).toBe(1.3);
    expect(drumVelocityRatio(points([32, 64, 96, 127], 1, 10))).toBe(0.3);
  });

  test('ignores velocities below 32 and gives up on flat or thin data', () => {
    expect(drumVelocityRatio(points([8, 16, 24, 64, 127], 9, 10))).toBeNull();
    expect(drumVelocityRatio(points([32, 64, 127], 9, 0.5))).toBeNull();
  });
});

describe('voiceVelocityDelta', () => {
  test('converts the slope difference into a modulator amount', () => {
    expect(voiceVelocityDelta(points([40, 64, 100, 127], 9, 10))).toBe(
      Math.round(-1 / DB_PER_DOUBLING_PER_AMOUNT),
    );
    expect(voiceVelocityDelta(points([64, 64, 64], 9, 10))).toBeNull();
  });
});

describe('differences', () => {
  test('averages reference minus measured, and the residual against the shifted target', () => {
    const p = points([32, 64], 0, 0, 5);
    expect(meanDifference(p)).toBe(5);
    expect(residualDb(p, 3)).toBe(2);
    expect(meanDifference([])).toBeNull();
    expect(residualDb([], 3)).toBeNull();
  });

  test('takes the largest difference as the common shift', () => {
    expect(commonShiftDb([3, null, 7.5, -2])).toBe(7.5);
    expect(() => commonShiftDb([null, null])).toThrow();
  });
});

describe('errorStats', () => {
  test('summarizes absolute errors and checks the criteria', () => {
    const stats = errorStats([0.1, -0.2, 0.3, 0.4, -3]);
    expect(stats).toEqual({ count: 5, median: 0.3, p90: 3, max: 3 });
    expect(meetsCriteria(stats)).toBe(false);
    expect(meetsCriteria(errorStats([0.1, 0.2, 0.3, 0.4, 1.9, 0.2, 0.1, 0.1, 0.1, 0.1]))).toBe(
      true,
    );
    expect(errorStats([])).toEqual({ count: 0, median: 0, p90: 0, max: 0 });
  });
});
