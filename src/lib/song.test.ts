import { describe, expect, test } from 'bun:test';
import { buildSong } from './song.ts';
import type { SmfChunk, SmfFile, TrackEvent } from './smf/types.ts';

const meta = (deltaTime: number, metaType: number, data: number[]): TrackEvent => ({
  deltaTime,
  event: { kind: 'meta', metaType, data: new Uint8Array(data) },
});

const noteOn = (deltaTime: number, note: number): TrackEvent => ({
  deltaTime,
  event: { kind: 'noteOn', channel: 0, note, velocity: 100 },
});

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const makeSmf = (events: TrackEvent[], extraChunks: SmfChunk[] = []): SmfFile => ({
  header: { format: 0, trackCount: 1, division: { kind: 'tpqn', ticksPerQuarter: 480 } },
  tracks: [{ events }],
  extraChunks,
});

describe('buildSong', () => {
  test('takes time and key signatures from the SMF', () => {
    const song = buildSong(
      makeSmf([meta(0, 0x58, [3, 2, 24, 8]), meta(0, 0x59, [0xfe, 0]), noteOn(0, 60)]),
    );

    expect(song.timing.ppq).toBe(480);
    expect(song.timing.timeSignatures).toEqual([
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
    expect(song.timing.keySignatures).toEqual([
      { tick: 0, signature: { sharps: -2, mode: 'major' } },
    ]);
    expect(song.sequence.midiMessages.map((m) => m.data)).toEqual([[0x90, 60, 100]]);
    expect('timing' in song.xf).toBe(false);
  });

  test('parses lyrics and builds karaoke pages', () => {
    const song = buildSong(
      makeSmf([meta(0, 0x05, ascii('Hel')), meta(240, 0x05, ascii('lo')), meta(240, 0x05, [0x0d])]),
    );

    expect(song.karaoke.syllables.map((s) => s.tick)).toEqual([0, 240]);
    expect(song.karaokePages).toHaveLength(1);
    expect(song.karaokePages[0]!.lines[0]!.syllables).toHaveLength(2);
  });

  test('ends syllables at the note-off of the melody channel', () => {
    const song = buildSong(
      makeSmf([
        meta(0, 0x07, ascii('$Lyrc:1:0:')),
        meta(0, 0x05, ascii('a/')),
        noteOn(0, 60),
        { deltaTime: 240, event: { kind: 'noteOff', channel: 0, note: 60, velocity: 0 } },
        meta(720, 0x05, ascii('b')),
      ]),
    );

    expect(song.karaoke.syllables.map((s) => [s.tick, s.endTick])).toEqual([
      [0, 240],
      [960, null],
    ]);
  });

  test('builds the pitch lane from the melody channel', () => {
    const song = buildSong(
      makeSmf([
        meta(0, 0x07, ascii('$Lyrc:1:0:')),
        meta(0, 0x05, ascii('a')),
        noteOn(0, 60),
        { deltaTime: 240, event: { kind: 'noteOff', channel: 0, note: 60, velocity: 0 } },
      ]),
    );

    expect(song.pitchLane).toEqual({
      lowNote: 55,
      highNote: 66,
      sections: [
        {
          startTick: 0,
          endTick: 1920,
          barTicks: [],
          notes: [{ note: 60, startTick: 0, endTick: 240 }],
        },
      ],
    });
  });

  test('extracts chords and rehearsals in order and ignores other style messages', () => {
    const song = buildSong(
      makeSmf([
        meta(0, 0x7f, [0x43, 0x7b, 0x01, 0x31, 0x00, 0x7f, 0x7f]),
        meta(480, 0x7f, [0x43, 0x7b, 0x02, 0x03]),
        meta(0, 0x7f, [0x43, 0x7b, 0x03, 0x00, 0x01]),
        meta(480, 0x7f, [0x43, 0x7b, 0x01, 0x35, 0x13, 0x7f, 0x7f]),
      ]),
    );

    expect(song.chords.map((c) => [c.tick, c.root.note, c.type])).toEqual([
      [0, 'C', ''],
      [960, 'G', '7'],
    ]);
    expect(song.rehearsals.map((r) => [r.tick, r.letter])).toEqual([[480, 'A']]);
  });

  test('returns empty XF data without an error for an SMF without XF', () => {
    const song = buildSong(makeSmf([noteOn(0, 60)]));

    expect(song.xfError).toBeNull();
    expect(song.xf.version).toBeNull();
    expect(song.xf.karaoke.events).toEqual([]);
    expect(song.xf.style.events).toEqual([]);
    expect(song.chords).toEqual([]);
    expect(song.karaokePages).toEqual([]);
    expect(song.pitchLane).toBeNull();
    expect(song.sequence.midiMessages).toHaveLength(1);
  });

  test('keeps the playback sequence and reports the error when the XF data is broken', () => {
    const song = buildSong(
      makeSmf([noteOn(0, 60)], [{ type: 'XFKM', data: new Uint8Array([0x00, 0x90, 0x3c, 0x40]) }]),
    );

    expect(song.xfError).toMatch(/unexpected status.*XFKM/);
    expect(song.xf.karaoke.events).toEqual([]);
    expect(song.sequence.midiMessages.map((m) => m.data)).toEqual([[0x90, 60, 100]]);
  });
});
