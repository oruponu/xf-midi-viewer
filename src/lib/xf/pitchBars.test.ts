import { describe, expect, test } from 'bun:test';
import type { PlaybackNote } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import type { LyricSyllable } from './lyrics.ts';
import { buildPitchLane } from './pitchBars.ts';
import type { RehearsalLetter, RehearsalMessage, VocalPart } from './types.ts';

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

const rehearsal = (
  tick: number,
  letter: RehearsalLetter = 'A',
  variation = 0,
): RehearsalMessage => ({
  kind: 'rehearsal',
  tick,
  letter,
  variation,
});

const syllable = (tick: number, vocalPart: VocalPart | null): LyricSyllable => ({
  tick,
  endTick: null,
  runs: [],
  vocalPart,
});

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
  test('keeps only notes on the 1-based melody channels, in start order', () => {
    const result = buildPitchLane(
      [note(72, 240, 480, 1), note(60, 0, 240, 0), note(50, 0, 480, 2)],
      [1, 2],
      timing(),
      [],
      BAR,
    );

    expect(result!.notes).toEqual([
      { note: 60, startTick: 0, endTick: 240, part: 'base' },
      { note: 72, startTick: 240, endTick: 480, part: 'base' },
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

  test('shows 16 quarter notes at a time', () => {
    expect(lane(BAR)!.viewTicks).toBe(480 * 16);
  });
});

describe('buildPitchLane parts', () => {
  const partsOf = (notes: PlaybackNote[], syllables: LyricSyllable[]) =>
    buildPitchLane(notes, [1], timing(), [], BAR, syllables)!.notes.map((n) => n.part);

  test('takes the part of the last syllable at or before each note start', () => {
    const syllables = [syllable(0, 'male'), syllable(480, 'female'), syllable(960, 'mixed')];

    expect(
      partsOf(
        [note(60, 0, 240), note(60, 479, 480), note(60, 480, 720), note(60, 1200, 1440)],
        syllables,
      ),
    ).toEqual(['base', 'base', 'female', 'mixed']);
  });

  test('uses the base part before the first syllable and without syllables', () => {
    expect(partsOf([note(60, 0, 240), note(60, 480, 720)], [syllable(480, 'chorus')])).toEqual([
      'base',
      'other',
    ]);
    expect(partsOf([note(60, 0, 240)], [])).toEqual(['base']);
  });
});

describe('buildPitchLane bars', () => {
  test('starts a bar every 4/4 bar and ends at the end of the last bar', () => {
    const result = lane(BAR * 3);

    expect(result!.barTicks).toEqual([0, BAR, BAR * 2]);
    expect(result!.endTick).toBe(BAR * 3);
  });

  test('extends a song shorter than a bar to one full bar', () => {
    expect([lane(0)!.barTicks, lane(0)!.endTick]).toEqual([[0], BAR]);
    expect([lane(2000)!.barTicks, lane(2000)!.endTick]).toEqual([[0, BAR], BAR * 2]);
  });

  test('follows time signature changes', () => {
    const result = lane(11040, {
      sigs: [
        [0, 4, 4],
        [3840, 3, 4],
      ],
    });

    expect(result!.barTicks).toEqual([0, 1920, 3840, 5280, 6720, 8160, 9600]);
    expect(result!.endTick).toBe(11040);
  });

  test('starts a new bar at a time signature change in the middle of a bar', () => {
    const result = lane(5760, {
      sigs: [
        [0, 4, 4],
        [2880, 3, 4],
      ],
    });

    expect(result!.barTicks).toEqual([0, 1920, 2880, 4320]);
    expect(result!.endTick).toBe(5760);
  });

  test('assumes 4/4 before the first time signature', () => {
    expect(lane(5280, { sigs: [[3840, 3, 4]] })!.barTicks).toEqual([0, 1920, 3840]);
    expect(lane(BAR * 2, { sigs: [] })!.barTicks).toEqual([0, BAR]);
  });

  test('uses the last of several time signatures at the same tick', () => {
    const result = lane(2880, {
      sigs: [
        [0, 4, 4],
        [0, 3, 4],
      ],
    });

    expect(result!.barTicks).toEqual([0, 1440]);
  });
});

describe('buildPitchLane rehearsals', () => {
  test('labels rehearsal marks with their letter and variation', () => {
    const result = lane(BAR * 4, {
      rehearsals: [rehearsal(0, 'Intro'), rehearsal(BAR, 'A', 1), rehearsal(BAR * 2 + 100, 'B', 2)],
    });

    expect(result!.rehearsals).toEqual([
      { tick: 0, label: 'Intro' },
      { tick: BAR, label: "A'" },
      { tick: BAR * 2 + 100, label: "B''" },
    ]);
  });

  test('drops rehearsal marks at or after the end of the last bar', () => {
    const result = lane(2000, { rehearsals: [rehearsal(2100), rehearsal(BAR * 2)] });

    expect(result!.rehearsals).toEqual([{ tick: 2100, label: 'A' }]);
  });
});
