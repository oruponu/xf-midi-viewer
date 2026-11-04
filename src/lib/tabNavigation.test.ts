import { describe, expect, test } from 'bun:test';
import { tabIndexForKey } from './tabNavigation.ts';

describe('tabIndexForKey', () => {
  test('moves to the next tab on ArrowRight', () => {
    expect(tabIndexForKey('ArrowRight', 1, 4)).toBe(2);
  });

  test('wraps from the last tab to the first on ArrowRight', () => {
    expect(tabIndexForKey('ArrowRight', 3, 4)).toBe(0);
  });

  test('moves to the previous tab on ArrowLeft', () => {
    expect(tabIndexForKey('ArrowLeft', 2, 4)).toBe(1);
  });

  test('wraps from the first tab to the last on ArrowLeft', () => {
    expect(tabIndexForKey('ArrowLeft', 0, 4)).toBe(3);
  });

  test('moves to the first tab on Home', () => {
    expect(tabIndexForKey('Home', 2, 4)).toBe(0);
  });

  test('moves to the last tab on End', () => {
    expect(tabIndexForKey('End', 1, 4)).toBe(3);
  });

  test('ignores other keys', () => {
    expect(tabIndexForKey('ArrowDown', 1, 4)).toBeNull();
    expect(tabIndexForKey('Enter', 1, 4)).toBeNull();
    expect(tabIndexForKey(' ', 1, 4)).toBeNull();
  });

  test('ignores keys when there are no tabs', () => {
    expect(tabIndexForKey('ArrowRight', 0, 0)).toBeNull();
  });
});
