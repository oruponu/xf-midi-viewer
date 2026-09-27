import { describe, expect, test } from 'bun:test';
import { buildFixedKeyShifts, keyShiftAt, transposeMessages } from './fixedKey.ts';
import type { KeyShiftChange } from './fixedKey.ts';
import type { PlaybackMidiMessage } from './playback.ts';
import type { SmfTiming } from './timing.ts';

function timingWith(
  keys: Array<[tick: number, sharps: number, mode?: 'major' | 'minor']>,
): SmfTiming {
  return {
    ppq: 480,
    timeSignatures: [
      {
        tick: 0,
        signature: {
          numerator: 4,
          denominator: 4,
          clocksPerClick: 24,
          thirtySecondNotesPerQuarter: 8,
        },
      },
    ],
    keySignatures: keys.map(([tick, sharps, mode = 'major']) => ({
      tick,
      signature: { sharps, mode },
    })),
  };
}

function m(tick: number, data: number[]): PlaybackMidiMessage {
  return { tick, seconds: tick / 960, data };
}

const noDrums: ReadonlySet<number> = new Set();

describe('buildFixedKeyShifts', () => {
  test('picks the nearer direction within -6 to +5', () => {
    expect(buildFixedKeyShifts(timingWith([[0, 0]]))).toEqual([{ tick: 0, semitones: 0 }]);
    expect(buildFixedKeyShifts(timingWith([[0, 1]]))).toEqual([{ tick: 0, semitones: 5 }]);
    expect(buildFixedKeyShifts(timingWith([[0, 4]]))).toEqual([{ tick: 0, semitones: -4 }]);
    expect(buildFixedKeyShifts(timingWith([[0, -2]]))).toEqual([{ tick: 0, semitones: 2 }]);
  });

  test('moves F# and Gb down by 6', () => {
    expect(buildFixedKeyShifts(timingWith([[0, 6]]))).toEqual([{ tick: 0, semitones: -6 }]);
    expect(buildFixedKeyShifts(timingWith([[0, -6]]))).toEqual([{ tick: 0, semitones: -6 }]);
  });

  test('gives a minor key the same shift as the major key with the same signature', () => {
    expect(buildFixedKeyShifts(timingWith([[0, 1, 'minor']]))).toEqual([{ tick: 0, semitones: 5 }]);
    expect(buildFixedKeyShifts(timingWith([[0, 0, 'minor']]))).toEqual([{ tick: 0, semitones: 0 }]);
  });

  test('chooses each key independently of the previous one', () => {
    expect(
      buildFixedKeyShifts(
        timingWith([
          [0, -1],
          [1920, 6],
          [3840, 1],
        ]),
      ),
    ).toEqual([
      { tick: 0, semitones: -5 },
      { tick: 1920, semitones: -6 },
      { tick: 3840, semitones: 5 },
    ]);
    expect(
      buildFixedKeyShifts(
        timingWith([
          [0, -1, 'minor'],
          [1920, 2],
        ]),
      ),
    ).toEqual([
      { tick: 0, semitones: -5 },
      { tick: 1920, semitones: -2 },
    ]);
  });

  test('does not add an entry when the shift stays the same', () => {
    expect(
      buildFixedKeyShifts(
        timingWith([
          [0, 0],
          [1920, 0, 'minor'],
        ]),
      ),
    ).toEqual([{ tick: 0, semitones: 0 }]);
  });

  test('returns null when there is no key signature', () => {
    expect(buildFixedKeyShifts(timingWith([]))).toBeNull();
  });

  test('starts at tick 0 even when the first key signature comes later', () => {
    expect(buildFixedKeyShifts(timingWith([[960, 1]]))).toEqual([{ tick: 0, semitones: 5 }]);
  });

  test('uses the last key signature at the same tick', () => {
    expect(
      buildFixedKeyShifts(
        timingWith([
          [0, 0],
          [0, 2],
        ]),
      ),
    ).toEqual([{ tick: 0, semitones: -2 }]);
    expect(
      buildFixedKeyShifts(
        timingWith([
          [0, 0],
          [1920, 1],
          [1920, 0],
        ]),
      ),
    ).toEqual([{ tick: 0, semitones: 0 }]);
  });
});

describe('keyShiftAt', () => {
  const shifts: KeyShiftChange[] = [
    { tick: 0, semitones: 2 },
    { tick: 1920, semitones: -3 },
  ];

  test('returns the shift of the last change at or before the tick', () => {
    expect(keyShiftAt(0, shifts)).toBe(2);
    expect(keyShiftAt(1919, shifts)).toBe(2);
    expect(keyShiftAt(1920, shifts)).toBe(-3);
    expect(keyShiftAt(5000, shifts)).toBe(-3);
  });

  test('returns 0 for an empty table', () => {
    expect(keyShiftAt(100, [])).toBe(0);
  });
});

describe('transposeMessages', () => {
  const shifts: KeyShiftChange[] = [
    { tick: 0, semitones: 2 },
    { tick: 1920, semitones: -1 },
  ];

  test('shifts notes by the shift of their section', () => {
    const result = transposeMessages(
      [
        m(0, [0x90, 60, 100]),
        m(960, [0x80, 60, 0]),
        m(1920, [0x90, 60, 100]),
        m(2880, [0x80, 60, 0]),
      ],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0x80, 62, 0],
      [0x90, 59, 100],
      [0x80, 59, 0],
    ]);
  });

  test('shifts a note-off by the shift of its note-on across a key change', () => {
    const result = transposeMessages(
      [m(1000, [0x90, 60, 100]), m(2000, [0x80, 60, 0])],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0x80, 62, 0],
    ]);
  });

  test('treats a note-on with velocity 0 as a note-off', () => {
    const result = transposeMessages(
      [m(1000, [0x90, 60, 100]), m(2000, [0x90, 60, 0])],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0x90, 62, 0],
    ]);
  });

  test('pairs overlapping notes of the same pitch first in, first out', () => {
    const result = transposeMessages(
      [
        m(0, [0x90, 60, 100]),
        m(1920, [0x90, 60, 100]),
        m(2000, [0x80, 60, 0]),
        m(2100, [0x80, 60, 0]),
      ],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0x90, 59, 100],
      [0x80, 62, 0],
      [0x80, 59, 0],
    ]);
  });

  test('keeps each note-off with its own note-on when two pitches land on the same pitch', () => {
    const result = transposeMessages(
      [
        m(0, [0x90, 57, 100]),
        m(1920, [0x90, 60, 100]),
        m(2000, [0x80, 60, 0]),
        m(2100, [0x80, 57, 0]),
      ],
      [
        { tick: 0, semitones: 2 },
        { tick: 1920, semitones: -1 },
      ],
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 59, 100],
      [0x90, 59, 100],
      [0x80, 59, 0],
      [0x80, 59, 0],
    ]);
  });

  test('uses the sounding shift for polyphonic key pressure and the section shift otherwise', () => {
    const result = transposeMessages(
      [m(1000, [0x90, 60, 100]), m(2000, [0xa0, 60, 50]), m(2000, [0xa0, 64, 50])],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0xa0, 62, 50],
      [0xa0, 63, 50],
    ]);
  });

  test('forgets the sounding notes of a channel after an all-notes-off on that channel', () => {
    const result = transposeMessages(
      [
        m(0, [0x90, 60, 100]),
        m(0, [0x91, 60, 100]),
        m(1000, [0xb0, 123, 0]),
        m(1920, [0x90, 60, 100]),
        m(2000, [0x80, 60, 0]),
        m(2100, [0x81, 60, 0]),
      ],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([
      [0x90, 62, 100],
      [0x91, 62, 100],
      [0xb0, 123, 0],
      [0x90, 59, 100],
      [0x80, 59, 0],
      [0x81, 62, 0],
    ]);
  });

  test('forgets the sounding notes after all-sound-off and mode messages', () => {
    for (const controller of [120, 124, 125, 126, 127]) {
      const result = transposeMessages(
        [
          m(0, [0x90, 60, 100]),
          m(1000, [0xb0, controller, 0]),
          m(1920, [0x90, 60, 100]),
          m(2000, [0x80, 60, 0]),
        ],
        shifts,
        noDrums,
      );
      expect(result.at(-1)!.data).toEqual([0x80, 59, 0]);
    }
  });

  test('forgets the sounding notes of every channel after a reset SysEx', () => {
    const xgSystemOn = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
    const result = transposeMessages(
      [
        m(0, [0x90, 60, 100]),
        m(0, [0x91, 60, 100]),
        m(1000, xgSystemOn),
        m(1920, [0x90, 60, 100]),
        m(1920, [0x91, 60, 100]),
        m(2000, [0x80, 60, 0]),
        m(2000, [0x81, 60, 0]),
      ],
      shifts,
      noDrums,
    );
    expect(result.slice(-2).map((r) => r.data)).toEqual([
      [0x80, 59, 0],
      [0x81, 59, 0],
    ]);
  });

  test('does not shift drum channels', () => {
    const drum = m(0, [0x99, 36, 100]);
    const result = transposeMessages([drum], shifts, new Set([9]));
    expect(result[0]).toBe(drum);
  });

  test('drops both the note-on and the note-off when the shifted pitch is out of range', () => {
    const result = transposeMessages(
      [m(0, [0x90, 127, 100]), m(10, [0xb0, 7, 100]), m(960, [0x80, 127, 0])],
      shifts,
      noDrums,
    );
    expect(result.map((r) => r.data)).toEqual([[0xb0, 7, 100]]);
  });

  test('keeps non-note messages as the same objects and does not modify the input', () => {
    const cc = m(0, [0xb0, 7, 100]);
    const on = m(0, [0x90, 60, 100]);
    const result = transposeMessages([cc, on], shifts, noDrums);
    expect(result[0]).toBe(cc);
    expect(on.data).toEqual([0x90, 60, 100]);
  });
});
