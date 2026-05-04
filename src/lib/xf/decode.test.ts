import { describe, expect, test } from 'bun:test';
import { decodeLatin1, decodeXfText } from './decode.ts';

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('decodeLatin1', () => {
  test('decodes ASCII', () => {
    expect(decodeLatin1(u8(0x48, 0x69))).toBe('Hi');
  });

  test('decodes Latin-1 high bytes', () => {
    expect(decodeLatin1(u8(0xe9))).toBe('é');
  });

  test('decodes empty input', () => {
    expect(decodeLatin1(u8())).toBe('');
  });
});

describe('decodeXfText', () => {
  test('JP language decodes Shift-JIS', () => {
    expect(decodeXfText(u8(0x82, 0xa0), 'JP')).toBe('あ');
  });

  test('L1 language decodes Latin-1', () => {
    expect(decodeXfText(u8(0xe9), 'L1')).toBe('é');
  });

  test('undefined language defaults to Latin-1', () => {
    expect(decodeXfText(u8(0xe9), undefined)).toBe('é');
  });

  test('unknown language falls back to Latin-1', () => {
    expect(decodeXfText(u8(0xe9), 'XX')).toBe('é');
  });
});
