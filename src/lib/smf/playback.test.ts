import { describe, expect, test } from 'bun:test';
import { buildPlaybackSequence } from './playback.ts';
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
