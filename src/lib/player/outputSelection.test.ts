import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_OUTPUT_ID,
  isBuiltinPreferred,
  resolveOutputSelection,
} from './outputSelection.ts';

describe('resolveOutputSelection', () => {
  test('selects the built-in synth when nothing is stored', () => {
    expect(resolveOutputSelection(null, ['port-a'], true)).toBe(BUILTIN_OUTPUT_ID);
  });

  test('falls back to the first MIDI port when the built-in synth is unsupported', () => {
    expect(resolveOutputSelection(null, ['port-a', 'port-b'], false)).toBe('port-a');
    expect(resolveOutputSelection(BUILTIN_OUTPUT_ID, ['port-a'], false)).toBe('port-a');
    expect(resolveOutputSelection(BUILTIN_OUTPUT_ID, [], false)).toBe('');
  });

  test('keeps the stored MIDI port when it is available', () => {
    expect(resolveOutputSelection('port-b', ['port-a', 'port-b'], true)).toBe('port-b');
  });

  test('stays disconnected instead of switching when the stored MIDI port is missing', () => {
    expect(resolveOutputSelection('port-b', ['port-a'], true)).toBe('');
    expect(resolveOutputSelection('port-b', [], true)).toBe('');
  });
});

describe('isBuiltinPreferred', () => {
  test('is true for nothing stored or the built-in ID only when supported', () => {
    expect(isBuiltinPreferred(null, true)).toBe(true);
    expect(isBuiltinPreferred(BUILTIN_OUTPUT_ID, true)).toBe(true);
    expect(isBuiltinPreferred('port-a', true)).toBe(false);
    expect(isBuiltinPreferred(null, false)).toBe(false);
  });
});
