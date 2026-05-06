import { describe, expect, test } from 'bun:test';
import type { SmfTrack, TrackEvent } from '../smf/types.ts';
import { extractStyle, parseStyleMessage } from './style.ts';
import type { RehearsalLetter } from './types.ts';

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

const styleMeta = (data: Uint8Array, deltaTime = 0): TrackEvent => ({
  deltaTime,
  event: { kind: 'meta', metaType: 0x7f, data },
});

describe('parseStyleMessage - dispatch', () => {
  test('returns null for non-Yamaha manufacturer', () => {
    expect(parseStyleMessage(u8(0x41, 0x00, 0x01, 0x00), 0)).toBeNull();
  });

  test('returns null for too-short data', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b), 0)).toBeNull();
  });

  test('returns null for unknown message type', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b, 0xff, 0x00), 0)).toBeNull();
  });
});

describe('parseStyleMessage - chord (0x01)', () => {
  test('parses C Maj at given tick', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x01, 0x31, 0x00, 0x7f, 0x7f),
      100,
    );
    expect(msg).toEqual({
      kind: 'chord',
      tick: 100,
      root: { note: 'C', accidental: 'natural' },
      type: '',
      bass: null,
    });
  });

  test('parses C M7 / G with bass', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x01, 0x31, 0x02, 0x35, 0x00),
      0,
    );
    expect(msg).toMatchObject({
      kind: 'chord',
      type: 'M7',
      bass: { root: { note: 'G', accidental: 'natural' }, type: '' },
    });
  });

  test('parses sharp accidental', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x01, 0x41, 0x00, 0x7f, 0x7f),
      0,
    );
    expect(msg).toMatchObject({
      kind: 'chord',
      root: { note: 'C', accidental: '#' },
    });
  });

  test('returns null for invalid accidental (fff=7)', () => {
    expect(
      parseStyleMessage(u8(0x43, 0x7b, 0x01, 0x71, 0x00, 0x7f, 0x7f), 0),
    ).toBeNull();
  });

  test('returns null for out-of-range type', () => {
    expect(
      parseStyleMessage(u8(0x43, 0x7b, 0x01, 0x31, 35, 0x7f, 0x7f), 0),
    ).toBeNull();
  });

  test('treats bn=127 as no bass even if bt is valid', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x01, 0x31, 0x00, 0x7f, 0x00),
      0,
    );
    expect(msg).toMatchObject({ kind: 'chord', bass: null });
  });
});

describe('parseStyleMessage - rehearsal (0x02)', () => {
  test.each<[number, RehearsalLetter, number]>([
    [0x00, 'Intro', 0],
    [0x01, 'Ending', 0],
    [0x02, 'Fill-in', 0],
    [0x03, 'A', 0],
    [0x0f, 'M', 0],
    [0x13, 'A', 1],
    [0x23, 'A', 2],
  ])('rr=0x%s -> letter=%s, variation=%s', (rr, letter, variation) => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x02, rr), 0);
    expect(msg).toEqual({ kind: 'rehearsal', tick: 0, letter, variation });
  });
});

describe('parseStyleMessage - phrase mark (0x03)', () => {
  test('right hand all-CH level 8', () => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x03, 0x20, 0x08), 0);
    expect(msg).toEqual({
      kind: 'phraseMark',
      tick: 0,
      hand: 'right',
      channel: null,
      level: 8,
    });
  });

  test('left hand CH 12 level 1', () => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x03, 0x4b, 0x01), 0);
    expect(msg).toEqual({
      kind: 'phraseMark',
      tick: 0,
      hand: 'left',
      channel: 12,
      level: 1,
    });
  });

  test('returns null for level 0', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b, 0x03, 0x20, 0x00), 0)).toBeNull();
  });

  test('returns null for level 128', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b, 0x03, 0x20, 0x80), 0)).toBeNull();
  });
});

describe('parseStyleMessage - max phrase mark (0x04)', () => {
  test('count = stored value + 1', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b, 0x04, 0x07), 0)).toEqual({
      kind: 'maxPhraseMark',
      tick: 0,
      count: 8,
    });
  });
});

describe('parseStyleMessage - fingering (0x05)', () => {
  test('right hand finger 1 keyboard CH 1 note 60', () => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x05, 0x00, 60, 0x01), 0);
    expect(msg).toEqual({
      kind: 'fingering',
      tick: 0,
      channel: 1,
      noteNumber: 60,
      fingering: 1,
      hand: 'right',
      context: 'keyboard',
    });
  });

  test('left hand pick guitar CH 11 note 60', () => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x05, 0x0a, 60, 0x1e), 0);
    expect(msg).toEqual({
      kind: 'fingering',
      tick: 0,
      channel: 11,
      noteNumber: 60,
      fingering: 6,
      hand: 'left',
      context: 'guitar',
    });
  });

  test('returns null for non-zero method (reserved)', () => {
    expect(
      parseStyleMessage(u8(0x43, 0x7b, 0x05, 0x20, 60, 0x01), 0),
    ).toBeNull();
  });
});

describe('parseStyleMessage - guide track flag (0x0C)', () => {
  test('right CH 1 / left CH 2', () => {
    expect(parseStyleMessage(u8(0x43, 0x7b, 0x0c, 0x01, 0x02), 0)).toEqual({
      kind: 'guideTrack',
      tick: 0,
      rightHandChannel: 1,
      leftHandChannel: 2,
    });
  });

  test('treats 0 as null (no channel)', () => {
    expect(
      parseStyleMessage(u8(0x43, 0x7b, 0x0c, 0x01, 0x00), 0),
    ).toMatchObject({ rightHandChannel: 1, leftHandChannel: null });
  });
});

describe('parseStyleMessage - guitar info (0x10)', () => {
  test('standard EADGBE on CH 11, capo 0, guitar', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x10, 0x0a, 0x00, 0x00, 40, 45, 50, 55, 59, 64),
      0,
    );
    expect(msg).toEqual({
      kind: 'guitarInfo',
      tick: 0,
      channel: 11,
      part: 'guitar',
      capo: 0,
      stringNotes: [40, 45, 50, 55, 59, 64],
    });
  });

  test('all-CH flag with bass part', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x10, 0x20, 0x01, 0x00, 28, 33, 38, 43),
      0,
    );
    expect(msg).toMatchObject({
      kind: 'guitarInfo',
      channel: null,
      part: 'bass',
      stringNotes: [28, 33, 38, 43],
    });
  });

  test('reserved part for unknown pp', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x10, 0x0a, 0xff, 0x00, 40),
      0,
    );
    expect(msg).toMatchObject({ kind: 'guitarInfo', part: 'reserved' });
  });
});

describe('parseStyleMessage - guitar chord voicing (0x12)', () => {
  test('C major shape (x32010)', () => {
    const msg = parseStyleMessage(
      u8(0x43, 0x7b, 0x12, 0x0a, 0, 0, 1, 1, 0, 0, 2, 2, 3, 3, 127, 0),
      0,
    );
    expect(msg).toEqual({
      kind: 'guitarVoicing',
      tick: 0,
      channel: 11,
      strings: [
        { fret: 0, finger: 0 },
        { fret: 1, finger: 1 },
        { fret: 0, finger: 0 },
        { fret: 2, finger: 2 },
        { fret: 3, finger: 3 },
        { fret: 127, finger: 0 },
      ],
    });
  });

  test('all-CH flag', () => {
    const msg = parseStyleMessage(u8(0x43, 0x7b, 0x12, 0x20, 0, 0), 0);
    expect(msg).toMatchObject({ kind: 'guitarVoicing', channel: null });
  });
});

describe('extractStyle', () => {
  test('walks tracks and accumulates ticks', () => {
    const track: SmfTrack = {
      events: [
        styleMeta(u8(0x43, 0x7b, 0x02, 0x00), 0),
        styleMeta(u8(0x43, 0x7b, 0x02, 0x03), 480),
      ],
    };
    expect(extractStyle([track]).events).toEqual([
      { kind: 'rehearsal', tick: 0, letter: 'Intro', variation: 0 },
      { kind: 'rehearsal', tick: 480, letter: 'A', variation: 0 },
    ]);
  });

  test('skips non-FF7F meta events', () => {
    const track: SmfTrack = {
      events: [
        {
          deltaTime: 0,
          event: { kind: 'meta', metaType: 0x05, data: u8(0x41, 0x42) },
        },
        styleMeta(u8(0x43, 0x7b, 0x02, 0x00), 100),
      ],
    };
    const events = extractStyle([track]).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'rehearsal', tick: 100 });
  });

  test('skips non-Yamaha sequencer-specific events', () => {
    const track: SmfTrack = {
      events: [styleMeta(u8(0x41, 0x00, 0x01, 0x00), 0)],
    };
    expect(extractStyle([track]).events).toEqual([]);
  });

  test('returns empty for empty tracks', () => {
    expect(extractStyle([])).toEqual({ events: [] });
  });
});
