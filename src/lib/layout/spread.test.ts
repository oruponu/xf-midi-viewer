import { describe, expect, test } from 'bun:test';
import { labelSpan, spreadLabels } from './spread.ts';
import type { SpreadItem } from './spread.ts';

function box(x: number, width: number): SpreadItem {
  return { x, left: 0, right: width };
}

describe('labelSpan', () => {
  test('returns 0 for no items', () => {
    expect(labelSpan([], 4)).toBe(0);
  });

  test('sums the extents and the gaps between them', () => {
    expect(labelSpan([box(0, 10), { x: 50, left: -3, right: 5 }], 2)).toBe(20);
  });
});

describe('spreadLabels', () => {
  test('returns an empty array for no items', () => {
    expect(spreadLabels([], 0, 100, 0)).toEqual([]);
  });

  test('keeps non-overlapping items at their desired positions', () => {
    expect(spreadLabels([box(0, 10), box(20, 10), box(50, 10)], 0, 100, 2)).toEqual([0, 20, 50]);
  });

  test('splits the displacement evenly between two overlapping items', () => {
    expect(spreadLabels([box(10, 10), box(15, 10)], 0, 100, 0)).toEqual([7.5, 17.5]);
  });

  test('keeps the gap between items', () => {
    expect(spreadLabels([box(10, 10), box(15, 10)], 0, 100, 2)).toEqual([6.5, 18.5]);
  });

  test('pushes a cluster away from the left bound', () => {
    expect(spreadLabels([box(0, 10), box(5, 10)], 0, 100, 0)).toEqual([0, 10]);
  });

  test('pushes a cluster away from the right bound', () => {
    expect(spreadLabels([box(85, 10), box(90, 10)], 0, 100, 0)).toEqual([80, 90]);
  });

  test('pulls a single item back inside the right bound', () => {
    expect(spreadLabels([box(95, 20)], 0, 100, 0)).toEqual([80]);
  });

  test('squeezes items into the bounds when they do not fit', () => {
    expect(spreadLabels([box(10, 10), box(12, 10), box(14, 10)], 0, 20, 0)).toEqual([0, 5, 10]);
  });

  test('ignores the gap when squeezing', () => {
    expect(spreadLabels([box(10, 10), box(12, 10)], 0, 15, 4)).toEqual([0, 5]);
  });

  test('keeps a wide item followed by a narrow one inside the bounds when squeezing', () => {
    const xs = spreadLabels([box(0, 10), box(10, 40), box(50, 10)], 0, 50, 0);
    expect(xs).toEqual([0, 8, 40]);
  });

  test('keeps an item sticking out to the left inside the bounds when squeezing', () => {
    const items: SpreadItem[] = [box(0, 10), { x: 5, left: -10, right: 5 }, box(10, 40)];
    expect(spreadLabels(items, 0, 50, 0)).toEqual([0, 10, 10]);
  });

  test('aligns a single item wider than the bounds to the left bound', () => {
    expect(spreadLabels([box(10, 30)], 0, 20, 0)).toEqual([0]);
  });

  test('only moves the items that collide', () => {
    expect(spreadLabels([box(0, 10), box(40, 10), box(45, 10)], 0, 100, 0)).toEqual([
      0, 37.5, 47.5,
    ]);
  });

  test('merges clusters that collide after being spread', () => {
    const xs = spreadLabels([box(20, 10), box(22, 10), box(34, 10)], 0, 100, 0);
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeCloseTo(46 / 3);
    expect(xs[1]).toBeCloseTo(46 / 3 + 10);
    expect(xs[2]).toBeCloseTo(46 / 3 + 20);
  });

  test('accounts for extents that stick out to the left of the anchor', () => {
    const items: SpreadItem[] = [
      { x: 10, left: 0, right: 10 },
      { x: 20, left: -4, right: 6 },
    ];
    expect(spreadLabels(items, 0, 100, 0)).toEqual([8, 22]);
  });

  test('keeps a left-sticking extent inside the left bound', () => {
    expect(spreadLabels([{ x: 2, left: -4, right: 6 }], 0, 100, 0)).toEqual([4]);
  });
});
