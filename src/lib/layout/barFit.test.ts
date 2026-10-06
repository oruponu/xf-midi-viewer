import { describe, expect, test } from 'bun:test';
import { MIN_LABEL_SCALE, barDemands, barFits, labelScale } from './barFit.ts';
import type { BarDemand, LabelDemands } from './barFit.ts';

const demand = (scalable: number, fixed: number): BarDemand => ({ scalable, fixed });

describe('barDemands', () => {
  test('returns no demands without labels', () => {
    expect(barDemands([], 2, 8).size).toBe(0);
  });

  test('groups labels by bar and separates the fixed widths', () => {
    const demands = barDemands(
      [
        { bar: 1, left: 0, right: 30, fixed: 8 },
        { bar: 1, left: -2, right: 20, fixed: 0 },
        { bar: 2, left: 0, right: 10, fixed: 0 },
      ],
      2,
      8,
    );
    expect(demands.get(1)).toEqual(demand(44, 20));
    expect(demands.get(2)).toEqual(demand(10, 4));
  });
});

describe('barFits', () => {
  const demands: LabelDemands = {
    chords: new Map([[1, demand(80, 20)]]),
    lyrics: new Map([
      [1, demand(50, 10)],
      [2, demand(150, 10)],
    ]),
  };

  test('fits when every layer is within the width', () => {
    expect(barFits(demands, 1, 100)).toBe(true);
  });

  test('does not fit when one layer is wider than the bar', () => {
    expect(barFits(demands, 2, 100)).toBe(false);
  });

  test('treats a bar without labels as fitting', () => {
    expect(barFits(demands, 3, 0)).toBe(true);
  });
});

describe('labelScale', () => {
  test('returns 1 when every bar fits', () => {
    expect(labelScale(new Map([[1, demand(80, 20)]]), 1, 1, 100)).toBe(1);
  });

  test('leaves the fixed widths unscaled', () => {
    const scale = labelScale(new Map([[1, demand(200, 20)]]), 1, 1, 171);
    expect(scale).toBe(0.75);
    expect(scale * 200 + 20).toBeLessThanOrEqual(171 - 1);
  });

  test('rounds the scale down to hundredths', () => {
    expect(labelScale(new Map([[1, demand(300, 10)]]), 1, 1, 231)).toBe(0.73);
  });

  test('uses the smallest scale in the row', () => {
    const demands = new Map([
      [1, demand(200, 20)],
      [2, demand(220, 20)],
    ]);
    expect(labelScale(demands, 1, 2, 200)).toBe(0.81);
  });

  test('ignores bars outside the row', () => {
    const demands = new Map([
      [1, demand(300, 10)],
      [5, demand(300, 10)],
    ]);
    expect(labelScale(demands, 2, 3, 100)).toBe(1);
  });

  test('stops at the minimum scale', () => {
    expect(labelScale(new Map([[1, demand(300, 10)]]), 1, 1, 100)).toBe(MIN_LABEL_SCALE);
  });

  test('stops at the minimum when the fixed widths alone overflow', () => {
    expect(labelScale(new Map([[1, demand(50, 200)]]), 1, 1, 190)).toBe(MIN_LABEL_SCALE);
  });

  test('stops at the minimum when nothing can scale', () => {
    expect(labelScale(new Map([[1, demand(0, 200)]]), 1, 1, 190)).toBe(MIN_LABEL_SCALE);
  });
});
