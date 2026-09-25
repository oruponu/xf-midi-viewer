import { describe, expect, test } from 'bun:test';
import type { PlaybackNote } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import { buildPitchLane, findPitchBarSection } from './pitchBars.ts';
import type { PitchLane } from './pitchBars.ts';
import type { RehearsalMessage } from './types.ts';

const BAR = 1920;

const timing = (sigs: [number, number, number][] = [[0, 4, 4]], ppq = 480): SmfTiming => ({
  ppq,
  timeSignatures: sigs.map(([tick, numerator, denominator]) => ({
    tick,
    signature: { numerator, denominator, clocksPerClick: 24, thirtySecondNotesPerQuarter: 8 },
  })),
  keySignatures: [],
});

const note = (pitch: number, startTick: number, endTick: number, channel = 0): PlaybackNote => ({
  channel,
  note: pitch,
  velocity: 100,
  startTick,
  endTick,
  startSeconds: 0,
  durationSeconds: 0,
});

const rehearsal = (tick: number): RehearsalMessage => ({
  kind: 'rehearsal',
  tick,
  letter: 'A',
  variation: 0,
});

const ranges = (lane: PitchLane | null) => lane!.sections.map((s) => [s.startTick, s.endTick]);

const lane = (
  durationTicks: number,
  options: { sigs?: [number, number, number][]; rehearsals?: RehearsalMessage[] } = {},
) =>
  buildPitchLane(
    [note(60, 0, 240)],
    [1],
    timing(options.sigs),
    options.rehearsals ?? [],
    durationTicks,
  );

describe('buildPitchLane melody', () => {
  test('keeps only notes on the 1-based melody channels', () => {
    const result = buildPitchLane(
      [note(60, 0, 240, 0), note(72, 240, 480, 1), note(50, 0, 480, 2)],
      [1, 2],
      timing(),
      [],
      BAR,
    );

    expect(result!.sections[0]!.notes).toEqual([
      { note: 60, startTick: 0, endTick: 240 },
      { note: 72, startTick: 240, endTick: 480 },
    ]);
  });

  test('returns null without melody channels, melody notes or a tick-based division', () => {
    expect(buildPitchLane([note(60, 0, 240)], [], timing(), [], BAR)).toBeNull();
    expect(buildPitchLane([note(60, 0, 240, 3)], [1], timing(), [], BAR)).toBeNull();
    expect(buildPitchLane([note(60, 0, 240)], [1], timing([], 0), [], BAR)).toBeNull();
  });

  test('pads the range by a semitone on each side', () => {
    const result = buildPitchLane([note(60, 0, 240), note(79, 240, 480)], [1], timing(), [], BAR);

    expect([result!.lowNote, result!.highNote]).toEqual([59, 80]);
  });

  test('widens a narrow range to 12 rows around its center', () => {
    const result = buildPitchLane([note(60, 0, 240), note(62, 240, 480)], [1], timing(), [], BAR);

    expect([result!.lowNote, result!.highNote]).toEqual([56, 67]);
  });

  test('puts a note crossing a section boundary into both sections', () => {
    const result = buildPitchLane([note(60, 7000, 8000)], [1], timing(), [], BAR * 8);

    expect(result!.sections.map((s) => s.notes.length)).toEqual([1, 1]);
  });
});

describe('buildPitchLane sections', () => {
  test('splits every 4 bars and ends the last section at its bar end', () => {
    const result = lane(BAR * 10);

    expect(ranges(result)).toEqual([
      [0, BAR * 4],
      [BAR * 4, BAR * 8],
      [BAR * 8, BAR * 10],
    ]);
    expect(result!.sections[0]!.barTicks).toEqual([BAR, BAR * 2, BAR * 3]);
    expect(result!.sections[2]!.barTicks).toEqual([BAR * 9]);
  });

  test('extends a song shorter than a bar to one full bar', () => {
    expect(ranges(lane(0))).toEqual([[0, BAR]]);
    expect(ranges(lane(2000))).toEqual([[0, BAR * 2]]);
  });

  test('follows time signature changes', () => {
    const result = lane(3840 + 1440 * 5, {
      sigs: [
        [0, 4, 4],
        [3840, 3, 4],
      ],
    });

    expect(ranges(result)).toEqual([
      [0, 6720],
      [6720, 11040],
    ]);
    expect(result!.sections[0]!.barTicks).toEqual([1920, 3840, 5280]);
    expect(result!.sections[1]!.barTicks).toEqual([8160, 9600]);
  });

  test('starts a new bar at a time signature change in the middle of a bar', () => {
    const result = lane(5760, {
      sigs: [
        [0, 4, 4],
        [2880, 3, 4],
      ],
    });

    expect(ranges(result)).toEqual([[0, 5760]]);
    expect(result!.sections[0]!.barTicks).toEqual([1920, 2880, 4320]);
  });

  test('assumes 4/4 before the first time signature', () => {
    const result = lane(5280, { sigs: [[3840, 3, 4]] });

    expect(result!.sections[0]!.barTicks).toEqual([1920, 3840]);
    expect(ranges(lane(BAR * 2, { sigs: [] }))).toEqual([[0, BAR * 2]]);
  });

  test('uses the last of several time signatures at the same tick', () => {
    const result = lane(2880, {
      sigs: [
        [0, 4, 4],
        [0, 3, 4],
      ],
    });

    expect(result!.sections[0]!.barTicks).toEqual([1440]);
  });

  test('restarts the 4-bar count at a rehearsal mark', () => {
    expect(ranges(lane(BAR * 8, { rehearsals: [rehearsal(BAR * 6)] }))).toEqual([
      [0, BAR * 4],
      [BAR * 4, BAR * 6],
      [BAR * 6, BAR * 8],
    ]);
  });

  test('rounds a rehearsal mark down to the start of its bar', () => {
    const expected = [
      [0, BAR * 2],
      [BAR * 2, BAR * 6],
      [BAR * 6, BAR * 8],
    ];

    expect(ranges(lane(BAR * 8, { rehearsals: [rehearsal(BAR * 2 + 100)] }))).toEqual(expected);
    expect(
      ranges(lane(BAR * 8, { rehearsals: [rehearsal(BAR * 2), rehearsal(BAR * 2 + 60)] })),
    ).toEqual(expected);
  });

  test('rounds a rehearsal mark in a bar cut short by a time signature change', () => {
    const sigs: [number, number, number][] = [
      [0, 4, 4],
      [2880, 3, 4],
    ];

    expect(ranges(lane(5760, { sigs, rehearsals: [rehearsal(2400)] }))).toEqual([
      [0, 1920],
      [1920, 5760],
    ]);
    expect(ranges(lane(5760, { sigs, rehearsals: [rehearsal(2880)] }))).toEqual([
      [0, 2880],
      [2880, 5760],
    ]);
  });

  test('ignores rehearsal marks at the start or after the last bar', () => {
    expect(ranges(lane(BAR * 8, { rehearsals: [rehearsal(0), rehearsal(BAR * 20)] }))).toEqual([
      [0, BAR * 4],
      [BAR * 4, BAR * 8],
    ]);
  });

  test('splits at a rehearsal mark past the song end but inside the last bar', () => {
    expect(ranges(lane(2000, { rehearsals: [rehearsal(2100)] }))).toEqual([
      [0, BAR],
      [BAR, BAR * 2],
    ]);
  });
});

describe('findPitchBarSection', () => {
  test('finds the last section starting at or before the tick', () => {
    const sections = lane(BAR * 10)!.sections;

    expect(findPitchBarSection(sections, -5)).toBe(0);
    expect(findPitchBarSection(sections, 0)).toBe(0);
    expect(findPitchBarSection(sections, BAR * 4 - 1)).toBe(0);
    expect(findPitchBarSection(sections, BAR * 4)).toBe(1);
    expect(findPitchBarSection(sections, BAR * 100)).toBe(2);
  });
});
