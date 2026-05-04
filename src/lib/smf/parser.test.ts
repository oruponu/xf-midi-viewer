import { describe, expect, test } from 'bun:test';
import { parseSmf } from './parser.ts';
import type { SmfEvent } from './types.ts';

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

const concat = (...arrays: Uint8Array[]): Uint8Array => {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

const mthd = (format: number, ntrks: number, division: number): Uint8Array =>
  u8(
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    (format >> 8) & 0xff,
    format & 0xff,
    (ntrks >> 8) & 0xff,
    ntrks & 0xff,
    (division >> 8) & 0xff,
    division & 0xff,
  );

const mtrk = (...payload: number[]): Uint8Array => {
  const len = payload.length;
  return u8(
    0x4d,
    0x54,
    0x72,
    0x6b,
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...payload,
  );
};

const EOT = [0x00, 0xff, 0x2f, 0x00];

describe('parseSmf - header', () => {
  test('parses format 0 with TPQ division', () => {
    const file = parseSmf(mthd(0, 1, 480));
    expect(file.header.format).toBe(0);
    expect(file.header.trackCount).toBe(1);
    expect(file.header.division).toEqual({
      kind: 'tpqn',
      ticksPerQuarter: 480,
    });
  });

  test('parses SMPTE division (25 fps, 40 ticks/frame)', () => {
    const file = parseSmf(mthd(1, 0, 0xe728));
    expect(file.header.division).toEqual({
      kind: 'smpte',
      framesPerSecond: 25,
      ticksPerFrame: 40,
    });
  });

  test('throws on wrong magic', () => {
    const buf = u8(0x58, 0x46, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0);
    expect(() => parseSmf(buf)).toThrow(/expected MThd/);
  });

  test('throws on too-short MThd length', () => {
    const buf = u8(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 5, 0, 0, 0, 1, 0x01);
    expect(() => parseSmf(buf)).toThrow(/MThd length too small/);
  });

  test('skips extra header bytes when length > 6', () => {
    const buf = u8(
      0x4d,
      0x54,
      0x68,
      0x64,
      0,
      0,
      0,
      8,
      0,
      0,
      0,
      1,
      0x01,
      0xe0,
      0xab,
      0xcd,
    );
    const file = parseSmf(buf);
    expect(file.header.format).toBe(0);
  });
});

describe('parseSmf - tracks', () => {
  test('parses note on / note off pair', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40, ...EOT),
    );
    const file = parseSmf(buf);
    expect(file.tracks).toHaveLength(1);
    const events = file.tracks[0]!.events;
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      deltaTime: 0,
      event: { kind: 'noteOn', channel: 0, note: 60, velocity: 64 },
    });
    expect(events[1]).toEqual({
      deltaTime: 96,
      event: { kind: 'noteOff', channel: 0, note: 60, velocity: 64 },
    });
    expect(events[2]?.event.kind).toBe('meta');
  });

  test('handles running status', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(0x00, 0x90, 0x3c, 0x40, 0x10, 0x3e, 0x40, 0x10, 0x40, 0x40, ...EOT),
    );
    const events = parseSmf(buf).tracks[0]!.events;
    expect(events).toHaveLength(4);
    expect(events[0]?.event).toMatchObject({ kind: 'noteOn', note: 60 });
    expect(events[1]?.event).toMatchObject({ kind: 'noteOn', note: 62 });
    expect(events[2]?.event).toMatchObject({ kind: 'noteOn', note: 64 });
  });

  test('meta event cancels running status', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(
        0x00,
        0x90,
        0x3c,
        0x40,
        0x00,
        0xff,
        0x06,
        0x01,
        0x41,
        0x00,
        0x3e,
        0x40,
        ...EOT,
      ),
    );
    expect(() => parseSmf(buf)).toThrow(/running status/);
  });

  test('parses tempo meta event', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, ...EOT),
    );
    const ev = parseSmf(buf).tracks[0]!.events[0]!.event;
    expect(ev.kind).toBe('meta');
    if (ev.kind === 'meta') {
      expect(ev.metaType).toBe(0x51);
      expect(Array.from(ev.data)).toEqual([0x07, 0xa1, 0x20]);
    }
  });

  test('parses sysex F0 event', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(0x00, 0xf0, 0x05, 0x43, 0x10, 0x4c, 0x01, 0xf7, ...EOT),
    );
    const ev = parseSmf(buf).tracks[0]!.events[0]!.event;
    expect(ev.kind).toBe('sysex');
    if (ev.kind === 'sysex') {
      expect(Array.from(ev.data)).toEqual([0x43, 0x10, 0x4c, 0x01, 0xf7]);
    }
  });

  test('parses sysex F7 escape event', () => {
    const buf = concat(
      mthd(0, 1, 480),
      mtrk(0x00, 0xf7, 0x02, 0xaa, 0xbb, ...EOT),
    );
    const ev = parseSmf(buf).tracks[0]!.events[0]!.event;
    expect(ev.kind).toBe('sysexEscape');
    if (ev.kind === 'sysexEscape') {
      expect(Array.from(ev.data)).toEqual([0xaa, 0xbb]);
    }
  });

  test('terminates track on End of Track and ignores trailing bytes', () => {
    const buf = concat(mthd(0, 1, 480), mtrk(...EOT, 0x00, 0x90, 0x3c, 0x40));
    expect(parseSmf(buf).tracks[0]!.events).toHaveLength(1);
  });

  test('throws on running status without prior status', () => {
    const buf = concat(mthd(0, 1, 480), mtrk(0x00, 0x3c, 0x40, ...EOT));
    expect(() => parseSmf(buf)).toThrow(/running status/);
  });
});

describe('parseSmf - channel voice events', () => {
  const cases: Array<[string, number[], SmfEvent]> = [
    [
      'noteOff',
      [0x80, 0x3c, 0x40],
      { kind: 'noteOff', channel: 0, note: 60, velocity: 64 },
    ],
    [
      'noteOn',
      [0x91, 0x3c, 0x7f],
      { kind: 'noteOn', channel: 1, note: 60, velocity: 127 },
    ],
    [
      'polyAftertouch',
      [0xa2, 0x3c, 0x50],
      { kind: 'polyAftertouch', channel: 2, note: 60, pressure: 80 },
    ],
    [
      'controlChange',
      [0xb3, 0x07, 0x64],
      { kind: 'controlChange', channel: 3, controller: 7, value: 100 },
    ],
    [
      'programChange',
      [0xc4, 0x10],
      { kind: 'programChange', channel: 4, program: 16 },
    ],
    [
      'channelAftertouch',
      [0xd5, 0x40],
      { kind: 'channelAftertouch', channel: 5, pressure: 64 },
    ],
    [
      'pitchBend center',
      [0xe6, 0x00, 0x40],
      { kind: 'pitchBend', channel: 6, value: 8192 },
    ],
    [
      'pitchBend max',
      [0xe7, 0x7f, 0x7f],
      { kind: 'pitchBend', channel: 7, value: 16383 },
    ],
  ];

  for (const [name, bytes, expected] of cases) {
    test(name, () => {
      const buf = concat(mthd(0, 1, 480), mtrk(0x00, ...bytes, ...EOT));
      const ev = parseSmf(buf).tracks[0]!.events[0]!.event;
      expect(ev).toEqual(expected);
    });
  }
});

describe('parseSmf - chunks', () => {
  test('preserves unknown chunks (e.g. XFIH) in extraChunks', () => {
    const xfih = u8(
      0x58,
      0x46,
      0x49,
      0x48,
      0x00,
      0x00,
      0x00,
      0x04,
      0xde,
      0xad,
      0xbe,
      0xef,
    );
    const buf = concat(mthd(0, 1, 480), mtrk(...EOT), xfih);
    const file = parseSmf(buf);
    expect(file.extraChunks).toHaveLength(1);
    expect(file.extraChunks[0]!.type).toBe('XFIH');
    expect(Array.from(file.extraChunks[0]!.data)).toEqual([
      0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  test('throws on multiple MThd', () => {
    const buf = concat(mthd(0, 1, 480), mthd(0, 1, 480));
    expect(() => parseSmf(buf)).toThrow(/multiple MThd/);
  });
});
