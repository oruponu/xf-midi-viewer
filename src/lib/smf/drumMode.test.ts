import { describe, expect, test } from 'bun:test';
import { isNoteMessage } from '../player/messages.ts';
import { DrumModeTracker, markDrumNotes, xgPartModeChange } from './drumMode.ts';
import type { PlaybackMidiMessage } from './playback.ts';

const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
const partMode = (part: number, mode: number) => [
  0xf0,
  0x43,
  0x10,
  0x4c,
  0x08,
  part,
  0x07,
  mode,
  0xf7,
];

function trackerAfter(...messages: number[][]): DrumModeTracker {
  const tracker = new DrumModeTracker();
  for (const data of messages) tracker.apply(data);
  return tracker;
}

describe('DrumModeTracker', () => {
  test('treats only channel 10 as drums at the start', () => {
    const tracker = new DrumModeTracker();
    for (let channel = 0; channel < 16; channel += 1) {
      expect(tracker.isDrum(channel)).toBe(channel === 9);
    }
    expect(tracker.bankMSB(9)).toBe(127);
    expect(tracker.bankMSB(0)).toBe(0);
  });

  test('switches a channel on the program change after a bank select', () => {
    const tracker = trackerAfter([0xb2, 0, 127]);
    expect(tracker.isDrum(2)).toBe(false);
    expect(tracker.bankMSB(2)).toBe(0);

    tracker.apply([0xc2, 0]);
    expect(tracker.isDrum(2)).toBe(true);
    expect(tracker.bankMSB(2)).toBe(127);

    tracker.apply([0xb2, 0, 0]);
    expect(tracker.isDrum(2)).toBe(true);

    tracker.apply([0xc2, 0]);
    expect(tracker.isDrum(2)).toBe(false);
  });

  test('treats bank MSB 126 as drums', () => {
    expect(trackerAfter([0xb3, 0, 126], [0xc3, 0]).isDrum(3)).toBe(true);
  });

  test('ignores other bank MSB values', () => {
    const tracker = trackerAfter([0xb3, 0, 64], [0xc3, 0], [0xb4, 0, 120], [0xc4, 0]);
    expect(tracker.isDrum(3)).toBe(false);
    expect(tracker.isDrum(4)).toBe(false);
  });

  test('lets an explicit Part Mode override the bank', () => {
    const tracker = trackerAfter(partMode(4, 2), partMode(9, 0));
    expect(tracker.isDrum(4)).toBe(true);
    expect(tracker.isDrum(9)).toBe(false);

    tracker.apply([0xb4, 0, 0]);
    tracker.apply([0xc4, 0]);
    expect(tracker.isDrum(4)).toBe(true);
  });

  test('keeps an explicit Part Mode until the program change after bank MSB 127', () => {
    const drum = trackerAfter(partMode(3, 1), [0xb3, 0, 127]);
    expect(drum.isDrum(3)).toBe(true);

    const normal = trackerAfter(partMode(9, 0), [0xb9, 0, 127]);
    expect(normal.isDrum(9)).toBe(false);
    normal.apply([0xc9, 0]);
    expect(normal.isDrum(9)).toBe(true);
  });

  test('clears the Part Mode on the program change even if a later bank select is not a drum bank', () => {
    const tracker = trackerAfter(partMode(3, 1), [0xb3, 0, 127], [0xb3, 0, 0]);
    expect(tracker.isDrum(3)).toBe(true);

    tracker.apply([0xc3, 0]);
    expect(tracker.isDrum(3)).toBe(false);
  });

  test('keeps a Part Mode received between the bank select and the program change', () => {
    const tracker = trackerAfter([0xb2, 0, 127], partMode(2, 0), [0xc2, 0]);
    expect(tracker.isDrum(2)).toBe(false);
  });

  test('returns every channel to the initial state on a reset SysEx', () => {
    const tracker = trackerAfter(
      [0xb2, 0, 127],
      [0xc2, 0],
      partMode(9, 0),
      [0xb4, 0, 127],
      XG_SYSTEM_ON,
      [0xc4, 0],
    );
    expect(tracker.isDrum(2)).toBe(false);
    expect(tracker.isDrum(4)).toBe(false);
    expect(tracker.isDrum(9)).toBe(true);
  });

  test('ignores messages that do not change the drum mode', () => {
    const tracker = trackerAfter(
      [0x92, 60, 100],
      [0xb2, 32, 127],
      [0xe2, 0, 64],
      [0xf0, 0x43, 0x10, 0x4c, 0x02, 0x01, 0x00, 0x01, 0xf7],
    );
    expect(tracker.isDrum(2)).toBe(false);
  });
});

describe('xgPartModeChange', () => {
  test('reads the part and whether the mode is a drum mode', () => {
    expect(xgPartModeChange([0x43, 0x10, 0x4c, 0x08, 0x04, 0x07, 0x02, 0xf7])).toEqual({
      channel: 4,
      isDrum: true,
    });
    expect(xgPartModeChange([0x43, 0x10, 0x4c, 0x08, 0x09, 0x07, 0x00, 0xf7])).toEqual({
      channel: 9,
      isDrum: false,
    });
  });

  test('rejects other parameters, unknown modes and parts above 16', () => {
    expect(xgPartModeChange([0x43, 0x10, 0x4c, 0x08, 0x04, 0x01, 0x02, 0xf7])).toBeNull();
    expect(xgPartModeChange([0x43, 0x10, 0x4c, 0x08, 0x04, 0x07, 0x04, 0xf7])).toBeNull();
    expect(xgPartModeChange([0x43, 0x10, 0x4c, 0x08, 0x10, 0x07, 0x01, 0xf7])).toBeNull();
  });
});

const at = (tick: number, data: number[]): PlaybackMidiMessage => ({
  tick,
  seconds: tick / 960,
  data,
});

function noteMarks(messages: PlaybackMidiMessage[]): boolean[] {
  markDrumNotes(messages);
  return messages.filter((m) => isNoteMessage(m.data)).map((m) => m.isDrum === true);
}

const toDrums = (tick: number, channel: number) => [
  at(tick, [0xb0 | channel, 0, 127]),
  at(tick, [0xc0 | channel, 0]),
];
const toMelody = (tick: number, channel: number) => [
  at(tick, [0xb0 | channel, 0, 0]),
  at(tick, [0xc0 | channel, 0]),
];

describe('markDrumNotes', () => {
  test('marks only the notes of drum sections', () => {
    const marks = noteMarks([
      at(0, [0x92, 60, 100]),
      at(100, [0x82, 60, 0]),
      ...toDrums(200, 2),
      at(300, [0x92, 36, 100]),
      at(400, [0x82, 36, 0]),
      ...toMelody(500, 2),
      at(600, [0x92, 62, 100]),
      at(700, [0x82, 62, 0]),
    ]);
    expect(marks).toEqual([false, false, true, true, false, false]);
  });

  test('marks notes on channel 10 from the start', () => {
    expect(noteMarks([at(0, [0x99, 36, 100]), at(100, [0x89, 36, 0])])).toEqual([true, true]);
  });

  test('marks a note-off like its note-on across a switch to melody', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      at(100, [0x92, 36, 100]),
      at(100, [0x92, 38, 100]),
      ...toMelody(200, 2),
      at(300, [0x82, 36, 0]),
      at(300, [0x92, 38, 0]),
    ]);
    expect(marks).toEqual([true, true, true, true]);
  });

  test('does not mark a note-off whose note-on started before a switch to drums', () => {
    const marks = noteMarks([at(100, [0x92, 60, 100]), ...toDrums(200, 2), at(300, [0x82, 60, 0])]);
    expect(marks).toEqual([false, false]);
  });

  test('pairs overlapping notes of the same pitch first in, first out', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      at(100, [0x92, 40, 100]),
      ...toMelody(200, 2),
      at(300, [0x92, 40, 100]),
      at(400, [0x82, 40, 0]),
      at(500, [0x82, 40, 0]),
    ]);
    expect(marks).toEqual([true, false, true, false]);
  });

  test('marks polyphonic key pressure like the sounding note and uses the current mode otherwise', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      at(100, [0x92, 36, 100]),
      ...toMelody(200, 2),
      at(300, [0xa2, 36, 50]),
      at(300, [0xa2, 60, 50]),
      at(400, [0x82, 36, 0]),
    ]);
    expect(marks).toEqual([true, true, false, true]);
  });

  test('uses the current mode for a note-off without a note-on', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      at(100, [0x82, 40, 0]),
      ...toMelody(200, 2),
      at(300, [0x82, 40, 0]),
    ]);
    expect(marks).toEqual([true, false]);
  });

  test('forgets the sounding notes of a channel after an all-notes-off', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      ...toDrums(0, 3),
      at(100, [0x92, 36, 100]),
      at(100, [0x93, 36, 100]),
      at(200, [0xb2, 123, 0]),
      ...toMelody(300, 2),
      ...toMelody(300, 3),
      at(400, [0x82, 36, 0]),
      at(400, [0x83, 36, 0]),
    ]);
    expect(marks).toEqual([true, true, false, true]);
  });

  test('forgets the sounding notes of every channel after a reset SysEx', () => {
    const marks = noteMarks([
      ...toDrums(0, 2),
      at(100, [0x92, 36, 100]),
      at(200, [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]),
      at(300, [0x82, 36, 0]),
    ]);
    expect(marks).toEqual([true, false]);
  });

  test('leaves non-note messages unmarked', () => {
    const messages = [...toDrums(0, 2), at(100, [0xb2, 7, 100]), at(100, [0xe2, 0, 64])];
    markDrumNotes(messages);
    expect(messages.every((m) => m.isDrum === undefined)).toBe(true);
  });
});
