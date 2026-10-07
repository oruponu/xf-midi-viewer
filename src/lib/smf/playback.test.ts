import { describe, expect, test } from 'bun:test';
import { buildPlaybackSequence, tickToSeconds, transposeMidiData } from './playback.ts';
import type { SmfFile, SmfTrack, TrackEvent } from './types.ts';

const makeSmf = (tracks: SmfTrack[], ppq = 480): SmfFile => ({
  header: {
    format: tracks.length > 1 ? 1 : 0,
    trackCount: tracks.length,
    division: { kind: 'tpqn', ticksPerQuarter: ppq },
  },
  tracks,
  extraChunks: [],
});

const track = (events: TrackEvent[]): SmfTrack => ({ events });

const noteOn = (deltaTime: number, note: number, velocity = 100, channel = 0): TrackEvent => ({
  deltaTime,
  event: { kind: 'noteOn', channel, note, velocity },
});

const noteOff = (deltaTime: number, note: number, velocity = 64, channel = 0): TrackEvent => ({
  deltaTime,
  event: { kind: 'noteOff', channel, note, velocity },
});

const tempo = (deltaTime: number, microsecondsPerQuarter: number): TrackEvent => ({
  deltaTime,
  event: {
    kind: 'meta',
    metaType: 0x51,
    data: new Uint8Array([
      (microsecondsPerQuarter >> 16) & 0xff,
      (microsecondsPerQuarter >> 8) & 0xff,
      microsecondsPerQuarter & 0xff,
    ]),
  },
});

const programChange = (deltaTime: number, program: number, channel = 0): TrackEvent => ({
  deltaTime,
  event: { kind: 'programChange', channel, program },
});

const controlChange = (
  deltaTime: number,
  controller: number,
  value: number,
  channel = 0,
): TrackEvent => ({
  deltaTime,
  event: { kind: 'controlChange', channel, controller, value },
});

const pitchBend = (deltaTime: number, value: number, channel = 0): TrackEvent => ({
  deltaTime,
  event: { kind: 'pitchBend', channel, value },
});

const sysex = (deltaTime: number, data: number[]): TrackEvent => ({
  deltaTime,
  event: { kind: 'sysex', data: new Uint8Array(data) },
});

const sysexEscape = (deltaTime: number, data: number[]): TrackEvent => ({
  deltaTime,
  event: { kind: 'sysexEscape', data: new Uint8Array(data) },
});

describe('buildPlaybackSequence', () => {
  test('pairs note on and off events with seconds at the default tempo', () => {
    const sequence = buildPlaybackSequence(makeSmf([track([noteOn(0, 60), noteOff(480, 60)])]));

    expect(sequence.notes).toHaveLength(1);
    expect(sequence.notes[0]).toMatchObject({
      channel: 0,
      note: 60,
      velocity: 100,
      startTick: 0,
      endTick: 480,
      startSeconds: 0,
      durationSeconds: 0.5,
    });
    expect(sequence.durationSeconds).toBe(0.5);
  });

  test('treats noteOn velocity 0 as note off', () => {
    const sequence = buildPlaybackSequence(makeSmf([track([noteOn(0, 62), noteOn(240, 62, 0)])]));

    expect(sequence.notes).toHaveLength(1);
    expect(sequence.notes[0]?.endTick).toBe(240);
    expect(sequence.notes[0]?.durationSeconds).toBe(0.25);
  });

  test('uses tempo changes when converting ticks to seconds', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([tempo(0, 500_000), tempo(480, 1_000_000)]),
        track([noteOn(0, 64), noteOff(960, 64)]),
      ]),
    );

    expect(sequence.tempos.map((change) => Math.round(change.bpm))).toEqual([120, 60]);
    expect(sequence.tempos[1]?.seconds).toBe(0.5);
    expect(sequence.notes[0]?.durationSeconds).toBe(1.5);
  });

  test('keeps notes sorted by playback time across tracks', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([noteOn(240, 67), noteOff(240, 67)]),
        track([noteOn(0, 60), noteOff(120, 60)]),
      ]),
    );

    expect(sequence.notes.map((note) => note.note)).toEqual([60, 67]);
  });

  test('builds timed channel messages for MIDI output ports', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          programChange(0, 4, 1),
          controlChange(120, 7, 100, 1),
          pitchBend(120, 8192, 1),
          noteOn(240, 72, 96, 1),
          noteOff(240, 72, 64, 1),
        ]),
      ]),
    );

    expect(sequence.midiMessages).toEqual([
      { tick: 0, seconds: 0, data: [0xc1, 4] },
      { tick: 120, seconds: 0.125, data: [0xb1, 7, 100] },
      { tick: 240, seconds: 0.25, data: [0xe1, 0, 64] },
      { tick: 480, seconds: 0.5, data: [0x91, 72, 96] },
      { tick: 720, seconds: 0.75, data: [0x81, 72, 64] },
    ]);
  });

  test('keeps the file order of messages at the same tick within a track', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          sysex(0, [0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]),
          controlChange(0, 7, 100),
          programChange(480, 40),
          pitchBend(0, 8192),
          noteOn(0, 60),
          noteOff(480, 60),
        ]),
      ]),
    );

    expect(sequence.midiMessages.map((message) => message.data)).toEqual([
      [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
      [0xb0, 7, 100],
      [0xc0, 40],
      [0xe0, 0, 64],
      [0x90, 60, 100],
      [0x80, 60, 64],
    ]);
  });

  test('orders messages at the same tick across tracks by track order', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([noteOn(480, 64, 100, 1), noteOff(480, 64, 64, 1)]),
        track([programChange(480, 40, 0), noteOn(0, 60, 100, 0), noteOff(480, 60, 64, 0)]),
      ]),
    );

    expect(sequence.midiMessages.map((message) => message.data)).toEqual([
      [0x91, 64, 100],
      [0xc0, 40],
      [0x90, 60, 100],
      [0x81, 64, 64],
      [0x80, 60, 64],
    ]);
  });

  test('joins a split sysex into one message at the tick of the first packet', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          sysex(0, [0x43, 0x10, 0x4c]),
          sysexEscape(10, [0x00, 0x00, 0x7e]),
          sysexEscape(10, [0x00, 0xf7]),
          noteOn(0, 60),
        ]),
      ]),
    );

    expect(sequence.midiMessages.map((m) => [m.tick, m.data])).toEqual([
      [0, [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]],
      [20, [0x90, 60, 100]],
    ]);
  });

  test('drops a split sysex that never terminates before the end of the track', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([track([noteOn(0, 60), sysex(10, [0x43, 0x10]), sysexEscape(10, [0x4c])])]),
    );

    expect(sequence.midiMessages.map((m) => m.data)).toEqual([[0x90, 60, 100]]);
  });

  test('drops a split sysex interrupted by another MIDI event', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([track([sysex(0, [0x43, 0x10]), noteOn(0, 60), sysexEscape(0, [0x4c, 0xf7])])]),
    );

    expect(sequence.midiMessages.map((m) => m.data)).toEqual([[0x90, 60, 100]]);
  });

  test('keeps valid escaped messages and drops invalid escapes and out-of-range channel data', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          sysexEscape(0, [0xf8]),
          sysexEscape(0, [0x10, 0x20]),
          noteOn(0, 60, 0x80),
          controlChange(0, 7, 100),
        ]),
      ]),
    );

    expect(sequence.midiMessages.map((m) => m.data)).toEqual([[0xf8], [0xb0, 7, 100]]);
  });

  test('splits an escape that carries several messages and keeps each valid one', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([track([sysexEscape(0, [0x90, 60, 100, 0x80, 60, 0, 0x10, 0xf8])])]),
    );

    expect(sequence.midiMessages.map((m) => m.data)).toEqual([
      [0x90, 60, 100],
      [0x80, 60, 0],
      [0xf8],
    ]);
  });

  test('joins a split sysex with a very large continuation packet', () => {
    const body = new Array<number>(2_000_000).fill(0x01);
    const sequence = buildPlaybackSequence(
      makeSmf([track([sysex(0, [0x43]), sysexEscape(0, [...body, 0xf7])])]),
    );

    expect(sequence.midiMessages).toHaveLength(1);
    expect(sequence.midiMessages[0]!.data).toHaveLength(2_000_003);
  });

  test('computes durationSeconds for huge sequences without overflowing the stack', () => {
    const events = Array.from({ length: 700_000 }, () => controlChange(1, 7, 100));
    const sequence = buildPlaybackSequence(makeSmf([track(events)]));

    expect(sequence.midiMessages).toHaveLength(700_000);
    expect(sequence.durationSeconds).toBeCloseTo(700_000 / 960, 3);
  });

  test('emits sysex events with the F0 status byte restored', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          sysex(0, [0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]),
          sysexEscape(120, [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]),
        ]),
      ]),
    );

    expect(sequence.midiMessages).toEqual([
      {
        tick: 0,
        seconds: 0,
        data: [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
      },
      {
        tick: 120,
        seconds: 0.125,
        data: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
      },
    ]);
  });

  test('marks the notes of drum sections in file order within a tick', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([
          controlChange(0, 0, 127, 8),
          programChange(0, 0, 8),
          noteOn(0, 36, 100, 8),
          noteOff(480, 36, 64, 8),
          controlChange(0, 0, 0, 8),
          programChange(0, 0, 8),
          noteOn(0, 60, 100, 8),
          noteOff(480, 60, 64, 8),
        ]),
      ]),
    );

    const notes = sequence.midiMessages.filter((m) => (m.data[0]! & 0xe0) === 0x80);
    expect(notes.map((m) => [m.data[1], m.isDrum === true])).toEqual([
      [36, true],
      [36, true],
      [60, false],
      [60, false],
    ]);
  });
});

describe('tickToSeconds', () => {
  test('converts ticks across tempo changes', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([tempo(0, 500_000), tempo(960, 1_000_000)]),
        track([noteOn(0, 64), noteOff(1920, 64)]),
      ]),
    );

    expect(tickToSeconds(480, sequence)).toBe(0.5);
    expect(tickToSeconds(960, sequence)).toBe(1);
    expect(tickToSeconds(1440, sequence)).toBe(2);
  });

  test('spends no time in a zero tempo segment like the playback timeline', () => {
    const sequence = buildPlaybackSequence(
      makeSmf([
        track([tempo(0, 500_000), tempo(480, 0), tempo(480, 500_000)]),
        track([noteOn(0, 64), noteOff(1920, 64)]),
      ]),
    );

    expect(tickToSeconds(720, sequence)).toBe(0.5);
    expect(tickToSeconds(1440, sequence)).toBe(1);
  });

  test('returns 0 for ticks at or before the start', () => {
    const sequence = buildPlaybackSequence(makeSmf([track([noteOn(0, 64), noteOff(480, 64)])]));

    expect(tickToSeconds(0, sequence)).toBe(0);
    expect(tickToSeconds(-10, sequence)).toBe(0);
  });

  test('scales ticks by the duration when there is no tempo map', () => {
    const sequence = buildPlaybackSequence({
      header: {
        format: 0,
        trackCount: 1,
        division: { kind: 'smpte', framesPerSecond: 25, ticksPerFrame: 40 },
      },
      tracks: [track([noteOn(0, 64), noteOff(2000, 64)])],
      extraChunks: [],
    });

    expect(tickToSeconds(1000, sequence)).toBe(1);
  });
});

describe('transposeMidiData', () => {
  test('returns the same array when semitones is 0', () => {
    const data = [0x90, 60, 100];
    expect(transposeMidiData(data, 0, false)).toBe(data);
  });

  test('shifts Note On pitch upward', () => {
    expect(transposeMidiData([0x90, 60, 100], 2, false)).toEqual([0x90, 62, 100]);
  });

  test('shifts Note Off pitch downward', () => {
    expect(transposeMidiData([0x80, 64, 0], -3, false)).toEqual([0x80, 61, 0]);
  });

  test('shifts Poly Aftertouch pitch', () => {
    expect(transposeMidiData([0xa3, 70, 64], 5, false)).toEqual([0xa3, 75, 64]);
  });

  test('does not shift a message marked as a drum', () => {
    const data = [0x92, 36, 110];
    expect(transposeMidiData(data, 5, true)).toBe(data);
  });

  test('shifts a note on channel 10 when it is not marked as a drum', () => {
    expect(transposeMidiData([0x99, 36, 110], 5, false)).toEqual([0x99, 41, 110]);
  });

  test('returns null when the resulting note is out of range', () => {
    expect(transposeMidiData([0x90, 125, 100], 6, false)).toBeNull();
    expect(transposeMidiData([0x90, 2, 100], -6, false)).toBeNull();
  });

  test('leaves non-note messages unchanged', () => {
    const cc = [0xb0, 7, 100];
    expect(transposeMidiData(cc, 4, false)).toBe(cc);
    const pitchBend = [0xe0, 0x00, 0x40];
    expect(transposeMidiData(pitchBend, -4, false)).toBe(pitchBend);
  });
});
