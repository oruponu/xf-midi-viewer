import { describe, expect, test } from 'bun:test';
import type { VocalPart } from './types.ts';
import { partColorOf } from './vocalPart.ts';
import type { PartColor } from './vocalPart.ts';

describe('partColorOf', () => {
  test.each<[VocalPart | null, PartColor]>([
    ['male', 'base'],
    ['solo', 'base'],
    [null, 'base'],
    ['female', 'female'],
    ['mixed', 'mixed'],
    ['chorus', 'other'],
    ['speech', 'other'],
    ['nonLyric', 'other'],
  ])('%p -> %p', (part, expected) => {
    expect(partColorOf(part)).toBe(expected);
  });
});
