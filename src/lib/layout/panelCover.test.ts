import { describe, expect, test } from 'bun:test';
import { bottomAlignedScrollTop, bottomCover, centeredScrollTop } from './panelCover.ts';

describe('bottomCover', () => {
  test('covers from the top of a full-width panel to the bottom of the viewport', () => {
    expect(bottomCover({ top: 237, left: 0 }, 844)).toBe(607);
  });

  test('covers nothing for a side panel', () => {
    expect(bottomCover({ top: 82, left: 934 }, 800)).toBe(0);
  });

  test('never covers a negative height', () => {
    expect(bottomCover({ top: 900, left: 0 }, 844)).toBe(0);
  });
});

describe('centeredScrollTop', () => {
  test('centers the target in the whole viewport', () => {
    expect(centeredScrollTop(1000, 600, 40, 0, 800)).toBe(1000 + 600 + 20 - 400);
  });

  test('centers the target between the top bars and the panel', () => {
    expect(centeredScrollTop(1000, 600, 40, 110, 237)).toBe(1000 + 600 + 20 - 173.5);
  });
});

describe('bottomAlignedScrollTop', () => {
  test('scrolls so that the bottom of the target meets the bottom of the visible area', () => {
    expect(bottomAlignedScrollTop(0, 328, 237)).toBe(91);
    expect(bottomAlignedScrollTop(132, 196, 237)).toBe(91);
  });
});
