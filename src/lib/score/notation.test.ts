import { describe, expect, test } from 'bun:test';
import { buildScoreModel } from './notation.ts';
import type { ScoreInput, ScoreStaff } from './notation.ts';
import type { ChannelPart, ChannelVoice } from '../smf/channelVoices.ts';
import type { PlaybackNote, PlaybackSequence } from '../smf/playback.ts';
import type { KeyShiftChange } from '../smf/fixedKey.ts';

const BAR = 1920;

function voice(tick: number, program: number, isDrum = false): ChannelVoice {
  return { tick, seconds: tick / 960, bankMSB: isDrum ? 127 : 0, bankLSB: 0, program, isDrum };
}

function part(channel: number, voices: ChannelVoice[]): ChannelPart {
  return { channel, firstNoteSeconds: 0, firstNoteVoiceIndex: 0, voices };
}

function note(channel: number, startTick: number, pitch: number, length = 480): PlaybackNote {
  return {
    channel,
    note: pitch,
    velocity: 100,
    startTick,
    endTick: startTick + length,
    startSeconds: startTick / 960,
    durationSeconds: length / 960,
  };
}

function model(
  notes: PlaybackNote[],
  parts: ChannelPart[],
  keyShifts: KeyShiftChange[] = [],
  ppq = 480,
): ReturnType<typeof buildScoreModel> {
  const durationTicks = Math.max(BAR, ...notes.map((n) => n.endTick));
  const sequence: PlaybackSequence = {
    notes,
    midiMessages: [],
    tempos: [],
    durationSeconds: durationTicks / 960,
    durationTicks,
    ticksPerQuarter: ppq,
  };
  const input: ScoreInput = {
    sequence,
    timing: { ppq, timeSignatures: [], keySignatures: [] },
    parts,
    sectionTicks: [],
    keyShifts,
  };
  return buildScoreModel(input);
}

function writtenKeys(staff: ScoreStaff, bars: ScoreStaff['bars'] = staff.bars): number[] {
  return bars.flat().flatMap((it) => it.keys);
}

describe('buildScoreModel', () => {
  test('returns no staves for a song without notes', () => {
    expect(model([], [part(0, [voice(0, 0)])]).staves).toEqual([]);
  });

  test('returns an empty score for SMPTE timing', () => {
    const m = model([note(0, 0, 60)], [part(0, [voice(0, 0)])], [], 0);
    expect([m.bars, m.staves]).toEqual([[], []]);
  });

  test('orders staves by channel and keeps one treble staff for a mid-range part', () => {
    const m = model(
      [note(1, 0, 40), note(0, 0, 60), note(0, 480, 72)],
      [part(0, [voice(0, 0)]), part(1, [voice(0, 0)])],
    );
    expect(m.staves.map((s) => [s.channel, s.kind, s.clef])).toEqual([
      [0, 'pitched', 'treble'],
      [1, 'pitched', 'bass'],
    ]);
  });

  test('uses a grand staff for a wide-range part', () => {
    const m = model([note(0, 0, 48), note(0, 480, 72)], [part(0, [voice(0, 0)])]);
    expect(m.staves.map((s) => [s.clef, s.continuation])).toEqual([
      ['treble', false],
      ['bass', true],
    ]);
    expect(writtenKeys(m.staves[0]!)).toEqual([72]);
    expect(writtenKeys(m.staves[1]!)).toEqual([48]);
  });

  test('writes bass voices an octave higher on a single bass staff', () => {
    const low = model([note(0, 0, 40)], [part(0, [voice(0, 33)])]);
    expect(writtenKeys(low.staves[0]!)).toEqual([52]);
    const high = model(
      [note(0, 0, 52), note(0, 480, 64), note(0, 960, 76)],
      [part(0, [voice(0, 33)])],
    );
    expect(high.staves.map((s) => s.clef)).toEqual(['bass']);
  });

  test('decides the bass octave per note when the voice changes', () => {
    const m = model(
      [note(0, 0, 40), note(0, BAR, 40), note(0, BAR + 480, 40)],
      [part(0, [voice(0, 33), voice(BAR, 0)])],
    );
    expect(writtenKeys(m.staves[0]!)).toEqual([52, 40, 40]);
  });

  test('transposes pitched notes but not drums', () => {
    const m = model(
      [note(0, 0, 60), note(9, 0, 38)],
      [part(0, [voice(0, 0)]), part(9, [voice(0, 0, true)])],
      [{ tick: 0, semitones: 2 }],
    );
    expect(writtenKeys(m.staves[0]!)).toEqual([62]);
    expect(writtenKeys(m.staves[1]!)).toEqual([38]);
  });

  test('drops notes transposed out of the MIDI range', () => {
    const m = model(
      [note(0, 0, 0), note(0, 480, 60)],
      [part(0, [voice(0, 0)])],
      [{ tick: 0, semitones: -1 }],
    );
    expect(m.staves.flatMap((s) => writtenKeys(s))).toEqual([59]);
  });

  test('splits a drum part into the drum set and percussion', () => {
    const m = model(
      [note(9, 0, 36), note(9, 0, 38), note(9, 0, 42), note(9, 480, 54)],
      [part(9, [voice(0, 0, true)])],
    );
    const [kit, perc] = m.staves;
    expect(m.staves.map((s) => [s.kind, s.clef])).toEqual([
      ['drumSet', 'percussion'],
      ['percussion', 'percussion'],
    ]);
    expect(writtenKeys(kit!)).toEqual([38, 42]);
    expect(writtenKeys(kit!, kit!.lowerBars)).toEqual([36]);
    expect(writtenKeys(perc!)).toEqual([54]);
  });

  test('splits a channel that switches between melodic and drum voices', () => {
    const m = model(
      [note(0, 0, 60), note(0, BAR, 38)],
      [part(0, [voice(0, 0), voice(BAR, 0, true)])],
    );
    expect(m.staves.map((s) => s.kind)).toEqual(['pitched', 'drumSet']);
    expect(writtenKeys(m.staves[0]!)).toEqual([60]);
    expect(writtenKeys(m.staves[1]!)).toEqual([38]);
  });

  test('marks a voice change at the first note played with the new name', () => {
    const bass = Array.from({ length: 12 }, (_, i) => note(0, i * 480, 40));
    const changed = model([...bass, note(0, 5760, 40)], [part(0, [voice(0, 33), voice(5700, 38)])]);
    expect(changed.staves[0]!.marks).toEqual([{ tick: 5760, name: 'SynBass1' }]);

    const twice = model(
      [...bass, note(0, 5760, 40)],
      [part(0, [voice(0, 33), voice(5700, 38), voice(5730, 0)])],
    );
    expect(twice.staves[0]!.marks).toEqual([{ tick: 5760, name: 'GrandPno' }]);
  });

  test("labels follow the voices of the staff's own kind", () => {
    const m = model(
      [note(0, 0, 60), note(0, BAR, 38), note(0, 2 * BAR, 60)],
      [part(0, [voice(0, 0), voice(BAR, 0, true), voice(2 * BAR, 33)])],
    );
    const [pitched, kit] = m.staves;
    expect(pitched!.labels).toEqual([
      { tick: 0, name: 'GrandPno' },
      { tick: 2 * BAR, name: 'FngrBass' },
    ]);
    expect(kit!.labels).toEqual([{ tick: BAR, name: 'Standard Kit' }]);
  });

  test('names the percussion set when it changes from the previous bar', () => {
    const m = model(
      [note(9, 0, 54), note(9, BAR, 54), note(9, 2 * BAR, 54), note(9, 2 * BAR + 480, 82)],
      [part(9, [voice(0, 0, true)])],
    );
    const perc = m.staves.find((s) => s.kind === 'percussion')!;
    expect(perc.marks).toEqual([
      { tick: 0, name: 'Tamb.' },
      { tick: 2 * BAR, name: 'Shaker / Tamb.' },
    ]);
    expect(perc.labels).toEqual(perc.marks);
  });
});
