import { describe, expect, test } from 'bun:test';
import { ByteReader } from './reader.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('ByteReader', () => {
  test('reads unsigned bytes sequentially', () => {
    const r = new ByteReader(bytes(0x01, 0x02, 0xff));
    expect(r.readUint8()).toBe(0x01);
    expect(r.readUint8()).toBe(0x02);
    expect(r.readUint8()).toBe(0xff);
    expect(r.eof).toBe(true);
  });

  test('reads big-endian uint16 / uint32', () => {
    const r = new ByteReader(bytes(0x12, 0x34, 0xde, 0xad, 0xbe, 0xef));
    expect(r.readUint16()).toBe(0x1234);
    expect(r.readUint32()).toBe(0xdeadbeef);
  });

  test('reads signed int8', () => {
    const r = new ByteReader(bytes(0x7f, 0x80, 0xff));
    expect(r.readInt8()).toBe(127);
    expect(r.readInt8()).toBe(-128);
    expect(r.readInt8()).toBe(-1);
  });

  test('readBytes returns an independent copy', () => {
    const src = bytes(0x01, 0x02, 0x03, 0x04);
    const r = new ByteReader(src);
    const copy = r.readBytes(3);
    expect(Array.from(copy)).toEqual([0x01, 0x02, 0x03]);
    copy[0] = 0xff;
    expect(src[0]).toBe(0x01);
  });

  test('readAscii decodes chunk type', () => {
    const r = new ByteReader(bytes(0x4d, 0x54, 0x68, 0x64));
    expect(r.readAscii(4)).toBe('MThd');
  });

  test('seek and skip move the cursor', () => {
    const r = new ByteReader(bytes(0x00, 0x11, 0x22, 0x33));
    r.skip(2);
    expect(r.position).toBe(2);
    expect(r.readUint8()).toBe(0x22);
    r.seek(0);
    expect(r.readUint8()).toBe(0x00);
  });

  test('throws when reading past end', () => {
    const r = new ByteReader(bytes(0x01));
    r.readUint8();
    expect(() => r.readUint8()).toThrow(RangeError);
  });

  test('seek out of bounds throws', () => {
    const r = new ByteReader(bytes(0x01, 0x02));
    expect(() => r.seek(-1)).toThrow(RangeError);
    expect(() => r.seek(3)).toThrow(RangeError);
    r.seek(2);
    expect(r.eof).toBe(true);
  });

  describe('readVarLen (MIDI VLQ)', () => {
    const cases: Array<[Uint8Array, number]> = [
      [bytes(0x00), 0],
      [bytes(0x40), 64],
      [bytes(0x7f), 127],
      [bytes(0x81, 0x00), 128],
      [bytes(0xc0, 0x00), 8192],
      [bytes(0xff, 0x7f), 16383],
      [bytes(0x81, 0x80, 0x00), 16384],
      [bytes(0xc0, 0x80, 0x00), 1048576],
      [bytes(0xff, 0xff, 0x7f), 2097151],
      [bytes(0x81, 0x80, 0x80, 0x00), 2097152],
      [bytes(0xff, 0xff, 0xff, 0x7f), 268435455],
    ];

    for (const [input, expected] of cases) {
      const hex = Array.from(input)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      test(`${hex} -> ${expected}`, () => {
        const r = new ByteReader(input);
        expect(r.readVarLen()).toBe(expected);
        expect(r.eof).toBe(true);
      });
    }

    test('throws when VLQ exceeds 4 bytes', () => {
      const r = new ByteReader(bytes(0x80, 0x80, 0x80, 0x80, 0x00));
      expect(() => r.readVarLen()).toThrow(/VLQ exceeds 4 bytes/);
    });
  });
});
