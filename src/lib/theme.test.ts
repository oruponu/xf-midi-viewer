import { describe, expect, test } from 'bun:test';
import { isTheme, nextTheme, resolveTheme } from './theme.ts';

describe('nextTheme', () => {
  test('cycles system, light, dark and back to system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});

describe('isTheme', () => {
  test('accepts the three themes', () => {
    expect(isTheme('system')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
  });

  test('rejects other values', () => {
    expect(isTheme('auto')).toBe(false);
    expect(isTheme('')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(1)).toBe(false);
  });
});

describe('resolveTheme', () => {
  test('follows the system preference for system', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });

  test('ignores the system preference for explicit themes', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
