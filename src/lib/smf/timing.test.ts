import { describe, expect, test } from 'bun:test';
import type { SmfFile, SmfTrack } from './types.ts';
import {
  extractTiming,
  formatBarBeat,
  formatKeySignature,
  formatTickAsBarBeat,
  tickToBarBeat,
} from './timing.ts';

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

const makeSmf = (tracks: SmfTrack[], ppq = 480, smpte = false): SmfFile => ({
  header: {
    format: 0,
    trackCount: tracks.length,
    division: smpte
      ? { kind: 'smpte', framesPerSecond: 25, ticksPerFrame: 40 }
      : { kind: 'tpqn', ticksPerQuarter: ppq },
  },
  tracks,
  extraChunks: [],
});

const timeSigMeta = (
  numerator: number,
  denominatorPow: number,
  deltaTime = 0,
) => ({
  deltaTime,
  event: {
    kind: 'meta' as const,
    metaType: 0x58,
    data: u8(numerator, denominatorPow, 24, 8),
  },
});

const keySigMeta = (sharps: number, minor: boolean, deltaTime = 0) => ({
  deltaTime,
  event: {
    kind: 'meta' as const,
    metaType: 0x59,
    data: u8(sharps & 0xff, minor ? 1 : 0),
  },
});

describe('extractTiming', () => {
  test('returns default 4/4 when no Time Signature events', () => {
    const timing = extractTiming(makeSmf([]));
    expect(timing.ppq).toBe(480);
    expect(timing.timeSignatures).toEqual([
      {
        tick: 0,
        signature: {
          numerator: 4,
          denominator: 4,
          clocksPerClick: 24,
          thirtySecondNotesPerQuarter: 8,
        },
      },
    ]);
  });

  test('extracts a single Time Signature', () => {
    const timing = extractTiming(makeSmf([{ events: [timeSigMeta(3, 2)] }]));
    expect(timing.timeSignatures).toEqual([
      {
        tick: 0,
        signature: {
          numerator: 3,
          denominator: 4,
          clocksPerClick: 24,
          thirtySecondNotesPerQuarter: 8,
        },
      },
    ]);
  });

  test('decodes denominator from power-of-two', () => {
    const timing = extractTiming(makeSmf([{ events: [timeSigMeta(6, 3)] }]));
    expect(timing.timeSignatures[0]?.signature.denominator).toBe(8);
  });

  test('prepends default 4/4 if first event is not at tick 0', () => {
    const timing = extractTiming(
      makeSmf([{ events: [timeSigMeta(3, 2, 1920)] }]),
    );
    expect(timing.timeSignatures).toHaveLength(2);
    expect(timing.timeSignatures[0]?.tick).toBe(0);
    expect(timing.timeSignatures[0]?.signature.numerator).toBe(4);
    expect(timing.timeSignatures[1]?.tick).toBe(1920);
    expect(timing.timeSignatures[1]?.signature.numerator).toBe(3);
  });

  test('sorts events from multiple tracks', () => {
    const timing = extractTiming(
      makeSmf([
        { events: [timeSigMeta(5, 2, 480)] },
        { events: [timeSigMeta(7, 2, 240)] },
      ]),
    );
    const ticks = timing.timeSignatures.map((c) => c.tick);
    expect(ticks).toEqual([0, 240, 480]);
  });

  test('SMPTE division yields ppq=0', () => {
    const timing = extractTiming(makeSmf([], 480, true));
    expect(timing.ppq).toBe(0);
  });

  test('returns empty keySignatures when no Key Signature events', () => {
    const timing = extractTiming(makeSmf([]));
    expect(timing.keySignatures).toEqual([]);
  });

  test('extracts a major Key Signature', () => {
    const timing = extractTiming(makeSmf([{ events: [keySigMeta(2, false)] }]));
    expect(timing.keySignatures).toEqual([
      { tick: 0, signature: { sharps: 2, mode: 'major' } },
    ]);
  });

  test('extracts a minor Key Signature', () => {
    const timing = extractTiming(makeSmf([{ events: [keySigMeta(0, true)] }]));
    expect(timing.keySignatures).toEqual([
      { tick: 0, signature: { sharps: 0, mode: 'minor' } },
    ]);
  });

  test('decodes flats as negative sharps via sign-extension', () => {
    const timing = extractTiming(
      makeSmf([{ events: [keySigMeta(-3, false)] }]),
    );
    expect(timing.keySignatures[0]?.signature.sharps).toBe(-3);
  });

  test('sorts Key Signatures from multiple tracks', () => {
    const timing = extractTiming(
      makeSmf([
        { events: [keySigMeta(2, false, 480)] },
        { events: [keySigMeta(-1, true, 240)] },
      ]),
    );
    const ticks = timing.keySignatures.map((c) => c.tick);
    expect(ticks).toEqual([240, 480]);
  });
});

describe('formatKeySignature', () => {
  test.each([
    [0, 'major', 'C'],
    [1, 'major', 'G'],
    [2, 'major', 'D'],
    [7, 'major', 'C#'],
    [-1, 'major', 'F'],
    [-2, 'major', 'Bb'],
    [-7, 'major', 'Cb'],
    [0, 'minor', 'Am'],
    [1, 'minor', 'Em'],
    [3, 'minor', 'F#m'],
    [-1, 'minor', 'Dm'],
    [-5, 'minor', 'Bbm'],
  ] as const)('sharps=%i mode=%s -> %s', (sharps, mode, expected) => {
    expect(formatKeySignature({ sharps, mode })).toBe(expected);
  });
});

describe('tickToBarBeat', () => {
  const timing4_4 = extractTiming(makeSmf([{ events: [timeSigMeta(4, 2)] }]));

  test.each([
    [0, { bar: 1, beat: 1, tickInBeat: 0 }],
    [240, { bar: 1, beat: 1, tickInBeat: 240 }],
    [480, { bar: 1, beat: 2, tickInBeat: 0 }],
    [720, { bar: 1, beat: 2, tickInBeat: 240 }],
    [1920, { bar: 2, beat: 1, tickInBeat: 0 }],
    [3840, { bar: 3, beat: 1, tickInBeat: 0 }],
  ])('4/4 480ppq: tick %i -> %p', (tick, expected) => {
    expect(tickToBarBeat(tick, timing4_4)).toEqual(expected);
  });

  test('3/4 480ppq: bar boundary at 1440 ticks', () => {
    const timing = extractTiming(makeSmf([{ events: [timeSigMeta(3, 2)] }]));
    expect(tickToBarBeat(1440, timing)).toEqual({
      bar: 2,
      beat: 1,
      tickInBeat: 0,
    });
  });

  test('handles a Time Signature change mid-song', () => {
    const timing = extractTiming(
      makeSmf([
        {
          events: [timeSigMeta(4, 2, 0), timeSigMeta(3, 2, 1920)],
        },
      ]),
    );
    expect(tickToBarBeat(1920, timing)).toEqual({
      bar: 2,
      beat: 1,
      tickInBeat: 0,
    });
    expect(tickToBarBeat(3360, timing)).toEqual({
      bar: 3,
      beat: 1,
      tickInBeat: 0,
    });
  });

  test('returns null for SMPTE division', () => {
    const timing = extractTiming(makeSmf([], 480, true));
    expect(tickToBarBeat(0, timing)).toBeNull();
  });

  test('returns null for negative tick', () => {
    expect(tickToBarBeat(-1, timing4_4)).toBeNull();
  });
});

describe('formatBarBeat / formatTickAsBarBeat', () => {
  test('formats as "bar:beat:tick"', () => {
    expect(formatBarBeat({ bar: 2, beat: 3, tickInBeat: 240 })).toBe('2:3:240');
  });

  test('formatTickAsBarBeat falls back to raw tick when SMPTE', () => {
    const timing = extractTiming(makeSmf([], 480, true));
    expect(formatTickAsBarBeat(1234, timing)).toBe('1234');
  });

  test('formatTickAsBarBeat uses bar:beat for TPQ', () => {
    const timing = extractTiming(makeSmf([{ events: [timeSigMeta(4, 2)] }]));
    expect(formatTickAsBarBeat(1920, timing)).toBe('2:1:0');
  });
});
