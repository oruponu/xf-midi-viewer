import { describe, expect, test } from 'bun:test';
import { parseSmf } from '../../../src/lib/smf/parser.ts';
import { buildPlaybackSequence } from '../../../src/lib/smf/playback.ts';
import { XG_SFX_VOICES } from '../xgSfxVoices.ts';
import {
  CALIBRATION_VOICES,
  DRUM_KEYS,
  DRUM_VELOCITIES,
  XG_DRUM_KITS,
  drumTestMidi,
  toSmf,
  voiceTestMidi,
} from './testMidi.ts';

const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];

describe('drumTestMidi', () => {
  test('starts with XG System On and a marker hit on the drum channel', () => {
    const midi = drumTestMidi([0], [36], [64]);
    expect(midi.messages[0]).toEqual({ seconds: 0, data: XG_SYSTEM_ON });
    expect(midi.markerSeconds).toBe(1.5);
    expect(midi.messages).toContainEqual({ seconds: 1.5, data: [0x99, 36, 127] });
  });

  test('hits every kit, key and velocity once, 1.5 s apart, after selecting each kit', () => {
    const midi = drumTestMidi([0, 25], [36, 38], [32, 127]);
    expect(midi.probes.map((p) => p.probe)).toEqual([
      { kit: 0, key: 36, velocity: 32 },
      { kit: 0, key: 36, velocity: 127 },
      { kit: 0, key: 38, velocity: 32 },
      { kit: 0, key: 38, velocity: 127 },
      { kit: 25, key: 36, velocity: 32 },
      { kit: 25, key: 36, velocity: 127 },
      { kit: 25, key: 38, velocity: 32 },
      { kit: 25, key: 38, velocity: 127 },
    ]);
    const times = midi.probes.map((p) => p.seconds);
    expect(times.slice(0, 4)).toEqual([3.5, 5, 6.5, 8]);
    expect(times[4]).toBe(10);
    expect(midi.messages).toContainEqual({ seconds: 9.5, data: [0xc9, 25] });
    expect(midi.messages).toContainEqual({ seconds: 3.5 + 10 / 960, data: [0x89, 36, 0] });
    expect(midi.endSeconds).toBe(times.at(-1)! + 1.5);
  });

  test('silences the channel 0.1 s before every hit', () => {
    const midi = drumTestMidi([0], [36, 38], [64]);
    for (const { seconds } of midi.probes) {
      expect(midi.messages).toContainEqual({ seconds: seconds - 0.1, data: [0xb9, 120, 0] });
    }
  });

  test('covers the XG drum kits, keys 13 to 84 and 16 velocities', () => {
    expect(XG_DRUM_KITS).toEqual([0, 1, 8, 16, 24, 25, 32, 40, 48]);
    expect([DRUM_KEYS[0], DRUM_KEYS.at(-1), DRUM_KEYS.length]).toEqual([13, 84, 72]);
    expect(DRUM_VELOCITIES).toEqual([
      8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 127,
    ]);
  });
});

describe('voiceTestMidi', () => {
  test('holds each note for 1 s and plays them 2.5 s apart after selecting the voice', () => {
    const midi = voiceTestMidi([{ bankMSB: 64, program: 32 }], [48, 60], [64]);
    expect(midi.messages).toContainEqual({ seconds: 3, data: [0xb0, 0, 64] });
    expect(midi.messages).toContainEqual({ seconds: 3, data: [0xc0, 32] });
    expect(midi.probes).toEqual([
      { probe: { bankMSB: 64, program: 32, note: 48, velocity: 64 }, seconds: 3.5 },
      { probe: { bankMSB: 64, program: 32, note: 60, velocity: 64 }, seconds: 6 },
    ]);
    expect(midi.messages).toContainEqual({ seconds: 4.5, data: [0x80, 48, 0] });
    expect(midi.messages).toContainEqual({ seconds: 5.9, data: [0xb0, 120, 0] });
  });

  test('lists the GM programs and the SFX voices that have a substitute', () => {
    const sfx = XG_SFX_VOICES.filter((v) => v.from !== null);
    expect(CALIBRATION_VOICES.length).toBe(128 + sfx.length);
    expect(CALIBRATION_VOICES[0]).toEqual({ bankMSB: 0, program: 0 });
    expect(CALIBRATION_VOICES).toContainEqual({ bankMSB: 64, program: sfx[0].program });
    const silent = XG_SFX_VOICES.find((v) => v.from === null)!;
    expect(CALIBRATION_VOICES).not.toContainEqual({ bankMSB: 64, program: silent.program });
  });
});

describe('toSmf', () => {
  test('writes a format 0 file that the app reads back with the same messages and times', () => {
    const midi = drumTestMidi([0], [36], [64, 127]);
    const sequence = buildPlaybackSequence(parseSmf(toSmf(midi)));
    expect(sequence.tempos[0].bpm).toBe(120);
    expect(sequence.midiMessages.map((m) => m.data)).toEqual(midi.messages.map((m) => m.data));
    sequence.midiMessages.forEach((m, i) =>
      expect(m.seconds).toBeCloseTo(midi.messages[i].seconds, 6),
    );
  });
});
