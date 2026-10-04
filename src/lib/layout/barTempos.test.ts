import { describe, expect, test } from 'bun:test';
import type { PlaybackTempoChange } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import { barTempos } from './barTempos.ts';

const BAR = 1920;

const timing: SmfTiming = {
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
  keySignatures: [],
};

const tempos = (...changes: [number, number][]): PlaybackTempoChange[] =>
  changes.map(([tick, bpm]) => ({ tick, seconds: 0, bpm }));

describe('barTempos', () => {
  test('shows the initial tempo at bar 1', () => {
    expect(barTempos(tempos([0, 120]), timing, 8)).toEqual(new Map([[1, 120]]));
  });

  test('shows a change at the bar where it starts', () => {
    expect(barTempos(tempos([0, 120], [BAR * 4, 96]), timing, 8)).toEqual(
      new Map([
        [1, 120],
        [5, 96],
      ]),
    );
  });

  test('shows a change within a bar at the next bar', () => {
    expect(barTempos(tempos([0, 120], [BAR * 2 + 480, 100]), timing, 8)).toEqual(
      new Map([
        [1, 120],
        [4, 100],
      ]),
    );
  });

  test('uses the last change before each bar during a ritardando', () => {
    const ritardando = tempos(
      [0, 120],
      [BAR * 6, 116],
      [BAR * 6 + 480, 112],
      [BAR * 6 + 960, 108],
      [BAR * 6 + 1440, 104],
      [BAR * 7, 100],
      [BAR * 7 + 480, 96],
    );
    expect(barTempos(ritardando, timing, 8)).toEqual(
      new Map([
        [1, 120],
        [7, 116],
        [8, 100],
      ]),
    );
  });

  test('rounds tempos to whole BPM', () => {
    expect(barTempos(tempos([0, 119.6], [BAR, 87.4]), timing, 8)).toEqual(
      new Map([
        [1, 120],
        [2, 87],
      ]),
    );
  });

  test('skips bars whose rounded tempo is unchanged', () => {
    expect(
      barTempos(tempos([0, 120], [BAR, 120.2], [BAR * 2, 120], [BAR * 3, 90]), timing, 8),
    ).toEqual(
      new Map([
        [1, 120],
        [4, 90],
      ]),
    );
  });

  test('ignores changes after the last bar', () => {
    expect(barTempos(tempos([0, 120], [BAR * 8, 60]), timing, 8)).toEqual(new Map([[1, 120]]));
  });

  test('returns nothing without tempos', () => {
    expect(barTempos([], timing, 8)).toEqual(new Map());
  });

  test('scales tempos by the playback rate', () => {
    expect(barTempos(tempos([0, 120], [BAR * 2, 90]), timing, 8, 0.5)).toEqual(
      new Map([
        [1, 60],
        [3, 45],
      ]),
    );
  });

  test('rounds tempos after scaling by the playback rate', () => {
    expect(barTempos(tempos([0, 120], [BAR, 120.4]), timing, 8, 1.5)).toEqual(
      new Map([
        [1, 180],
        [2, 181],
      ]),
    );
  });
});
