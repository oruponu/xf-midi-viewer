import { describe, expect, test } from 'bun:test';
import { extractMetaEvents, formatTempo, formatTimeSignature } from './metaEvents.ts';
import type { SmfFile, SmfTrack, TrackEvent } from './types.ts';

const makeSmf = (tracks: SmfTrack[]): SmfFile => ({
  header: {
    format: tracks.length > 1 ? 1 : 0,
    trackCount: tracks.length,
    division: { kind: 'tpqn', ticksPerQuarter: 480 },
  },
  tracks,
  extraChunks: [],
});

const meta = (deltaTime: number, metaType: number, data: number[]): TrackEvent => ({
  deltaTime,
  event: { kind: 'meta', metaType, data: new Uint8Array(data) },
});

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe('extractMetaEvents', () => {
  test('reads track name, time signatures, tempos and key signatures as stored', () => {
    const smf = makeSmf([
      {
        events: [
          meta(0, 0x03, ascii('Test Song')),
          meta(0, 0x58, [4, 2, 24, 8]),
          meta(0, 0x51, [0x07, 0xa1, 0x20]),
          meta(0, 0x59, [2, 0]),
          meta(1920, 0x58, [3, 2, 24, 8]),
          meta(0, 0x51, [0x07, 0xa3, 0x14]),
          meta(0, 0x59, [0xfd, 1]),
        ],
      },
    ]);
    expect(extractMetaEvents(smf)).toEqual({
      trackName: 'Test Song',
      timeSignatures: [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 1920, numerator: 3, denominator: 4 },
      ],
      tempos: [
        { tick: 0, microsecondsPerQuarter: 500000 },
        { tick: 1920, microsecondsPerQuarter: 500500 },
      ],
      keySignatures: [
        { tick: 0, signature: { sharps: 2, mode: 'major' } },
        { tick: 1920, signature: { sharps: -3, mode: 'minor' } },
      ],
    });
  });

  test('does not supply defaults for missing events', () => {
    const smf = makeSmf([{ events: [meta(0, 0x2f, [])] }]);
    expect(extractMetaEvents(smf)).toEqual({
      trackName: null,
      timeSignatures: [],
      tempos: [],
      keySignatures: [],
    });
  });

  test('takes track name from first track only', () => {
    const smf = makeSmf([
      { events: [meta(0, 0x03, ascii('Song'))] },
      { events: [meta(0, 0x03, ascii('Piano'))] },
    ]);
    expect(extractMetaEvents(smf).trackName).toBe('Song');
  });

  test('merges events from all tracks in tick order', () => {
    const smf = makeSmf([
      { events: [meta(960, 0x51, [0x07, 0xa1, 0x20])] },
      { events: [meta(0, 0x51, [0x0f, 0x42, 0x40])] },
    ]);
    expect(extractMetaEvents(smf).tempos).toEqual([
      { tick: 0, microsecondsPerQuarter: 1000000 },
      { tick: 960, microsecondsPerQuarter: 500000 },
    ]);
  });

  test('keeps every event at the same tick', () => {
    const smf = makeSmf([{ events: [meta(0, 0x58, [4, 2, 24, 8]), meta(0, 0x58, [6, 3, 36, 8])] }]);
    expect(extractMetaEvents(smf).timeSignatures).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 0, numerator: 6, denominator: 8 },
    ]);
  });

  test('skips truncated events', () => {
    const smf = makeSmf([
      { events: [meta(0, 0x58, [4]), meta(0, 0x51, [0x07, 0xa1]), meta(0, 0x59, [2])] },
    ]);
    const result = extractMetaEvents(smf);
    expect(result.timeSignatures).toEqual([]);
    expect(result.tempos).toEqual([]);
    expect(result.keySignatures).toEqual([]);
  });
});

describe('formatTempo', () => {
  test('formats whole BPM', () => {
    expect(formatTempo(500000)).toBe('120');
  });

  test('keeps up to two decimal places of BPM', () => {
    expect(formatTempo(500500)).toBe('119.88');
  });
});

describe('formatTimeSignature', () => {
  test('formats numerator over denominator', () => {
    expect(formatTimeSignature({ numerator: 6, denominator: 8 })).toBe('6/8');
  });
});
