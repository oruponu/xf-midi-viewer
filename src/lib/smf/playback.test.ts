import { describe, expect, test } from 'bun:test';
import {
  buildPlaybackSequence,
  detectDrumChannels,
  transposeMidiData,
} from './playback.ts';
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

const noteOn = (
  deltaTime: number,
  note: number,
  velocity = 100,
  channel = 0,
): TrackEvent => ({
  deltaTime,
  event: { kind: 'noteOn', channel, note, velocity },
});

const noteOff = (
  deltaTime: number,
  note: number,
  velocity = 64,
  channel = 0,
): TrackEvent => ({
  deltaTime,
  event: { kind: 'noteOff', channel, note, velocity },
});

const tempo = (
  deltaTime: number,
  microsecondsPerQuarter: number,
): TrackEvent => ({
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

const programChange = (
  deltaTime: number,
  program: number,
  channel = 0,
): TrackEvent => ({
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

const pitchBend = (
  deltaTime: number,
  value: number,
  channel = 0,
): TrackEvent => ({
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
    const sequence = buildPlaybackSequence(
      makeSmf([track([noteOn(0, 60), noteOff(480, 60)])]),
    );

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
    const sequence = buildPlaybackSequence(
      makeSmf([track([noteOn(0, 62), noteOn(240, 62, 0)])]),
    );

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

    expect(sequence.tempos.map((change) => Math.round(change.bpm))).toEqual([
      120, 60,
    ]);
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

  test('computes durationSeconds for huge sequences without overflowing the stack', () => {
    const events = Array.from({ length: 700_000 }, () =>
      controlChange(1, 7, 100),
    );
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
});

describe('transposeMidiData', () => {
  const noDrums: ReadonlySet<number> = new Set();

  test('returns the same array when semitones is 0', () => {
    const data = [0x90, 60, 100];
    expect(transposeMidiData(data, 0, noDrums)).toBe(data);
  });

  test('shifts Note On pitch upward', () => {
    expect(transposeMidiData([0x90, 60, 100], 2, noDrums)).toEqual([
      0x90, 62, 100,
    ]);
  });

  test('shifts Note Off pitch downward', () => {
    expect(transposeMidiData([0x80, 64, 0], -3, noDrums)).toEqual([
      0x80, 61, 0,
    ]);
  });

  test('shifts Poly Aftertouch pitch', () => {
    expect(transposeMidiData([0xa3, 70, 64], 5, noDrums)).toEqual([
      0xa3, 75, 64,
    ]);
  });

  test('does not shift any channel in the drum set', () => {
    const drums = new Set<number>([9, 10]);
    expect(transposeMidiData([0x99, 36, 110], 5, drums)).toEqual([
      0x99, 36, 110,
    ]);
    expect(transposeMidiData([0x9a, 38, 100], 5, drums)).toEqual([
      0x9a, 38, 100,
    ]);
  });

  test('shifts non-drum channels even when other channels are drums', () => {
    const drums = new Set<number>([9, 10]);
    expect(transposeMidiData([0x90, 60, 100], 5, drums)).toEqual([
      0x90, 65, 100,
    ]);
  });

  test('returns null when the resulting note is out of range', () => {
    expect(transposeMidiData([0x90, 125, 100], 6, noDrums)).toBeNull();
    expect(transposeMidiData([0x90, 2, 100], -6, noDrums)).toBeNull();
  });

  test('leaves non-note messages unchanged', () => {
    const cc = [0xb0, 7, 100];
    expect(transposeMidiData(cc, 4, noDrums)).toBe(cc);
    const pitchBend = [0xe0, 0x00, 0x40];
    expect(transposeMidiData(pitchBend, -4, noDrums)).toBe(pitchBend);
  });
});

describe('detectDrumChannels', () => {
  const cc = (
    deltaTime: number,
    controller: number,
    value: number,
    channel = 0,
  ): TrackEvent => ({
    deltaTime,
    event: { kind: 'controlChange', channel, controller, value },
  });

  const sysex = (deltaTime: number, body: number[]): TrackEvent => ({
    deltaTime,
    event: { kind: 'sysex', data: new Uint8Array(body) },
  });

  test('returns an empty set when there are no drum markers', () => {
    expect(detectDrumChannels(makeSmf([]))).toEqual(new Set());
  });

  test('adds a channel when Bank Select MSB is 127 (XG drum)', () => {
    const smf = makeSmf([track([cc(0, 0, 127, 10)])]);
    expect(detectDrumChannels(smf)).toEqual(new Set([10]));
  });

  test('ignores Bank Select MSB values other than 127', () => {
    const smf = makeSmf([
      track([cc(0, 0, 0, 3), cc(0, 0, 64, 4), cc(0, 0, 120, 5)]),
    ]);
    expect(detectDrumChannels(smf)).toEqual(new Set());
  });

  test('adds a channel from XG Part Mode SysEx (drum mode)', () => {
    // F0 43 10 4C 08 04 07 02 F7 -> part 4, mode 2 (Drum S1)
    const smf = makeSmf([
      track([sysex(0, [0x43, 0x10, 0x4c, 0x08, 0x04, 0x07, 0x02, 0xf7])]),
    ]);
    expect(detectDrumChannels(smf)).toEqual(new Set([4]));
  });

  test('ignores XG Part Mode SysEx with Normal mode', () => {
    const smf = makeSmf([
      track([sysex(0, [0x43, 0x10, 0x4c, 0x08, 0x04, 0x07, 0x00, 0xf7])]),
    ]);
    expect(detectDrumChannels(smf)).toEqual(new Set());
  });

  test('detects drum channels across multiple tracks', () => {
    const smf = makeSmf([
      track([cc(0, 0, 127, 11)]),
      track([sysex(0, [0x43, 0x10, 0x4c, 0x08, 0x0c, 0x07, 0x01, 0xf7])]),
    ]);
    expect(detectDrumChannels(smf)).toEqual(new Set([11, 12]));
  });
});
