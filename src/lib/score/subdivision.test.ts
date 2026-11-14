import { describe, expect, test } from 'bun:test';
import { buildBeats, detectSwing, NO_SWING, snapToBeats } from './subdivision.ts';
import type { Swing } from './subdivision.ts';
import type { ScoreBar } from './bars.ts';

const GRID = 20;

function bar(startTick: number, numerator = 4, denominator = 4): ScoreBar {
  return {
    startTick,
    ticks: (480 * 4 * numerator) / denominator,
    numerator,
    denominator,
    timeChanged: false,
    keySharps: 0,
    keyChanged: false,
    sectionStart: false,
  };
}

function stepsOf(ticks: number[], bars = [bar(0)], swing: Swing = NO_SWING): number[] {
  return buildBeats(ticks, bars, GRID, swing).map((b) => b.step);
}

describe('buildBeats', () => {
  test('splits bars into quarter beats, or dotted quarters in compound meters', () => {
    const beats = buildBeats([], [bar(0), bar(1920, 6, 8), bar(3360, 3, 8)], GRID, NO_SWING);
    expect(beats.map((b) => [b.start, b.len])).toEqual([
      [0, 24],
      [24, 24],
      [48, 24],
      [72, 24],
      [96, 36],
      [132, 36],
      [168, 24],
      [192, 12],
    ]);
  });

  test('keeps sixteenths where they fit', () => {
    expect(stepsOf([0, 120, 240, 360, 480, 720])).toEqual([6, 6, 6, 6]);
  });

  test('chooses eighth-note triplets in a beat played in thirds', () => {
    expect(stepsOf([0, 160, 320, 480, 640])).toEqual([8, 8, 6, 6]);
  });

  test('chooses sixteenth-note triplets and thirty-seconds only where they are exact', () => {
    expect(stepsOf([0, 80, 160, 240, 320, 400, 480, 540, 600])).toEqual([4, 3, 6, 6]);
  });

  test('keeps sixteenths for slightly late sixteenths played by hand', () => {
    expect(stepsOf([10, 150, 255, 380])).toEqual([6, 6, 6, 6]);
  });

  test('chooses eighth-note triplets for triplets played by hand', () => {
    expect(stepsOf([10, 175, 335])).toEqual([8, 6, 6, 6]);
  });

  test('counts a note played just before a beat as its downbeat', () => {
    const beats = buildBeats([470, 640, 800], [bar(0)], GRID, NO_SWING);
    expect(beats.map((b) => b.step)).toEqual([6, 8, 6, 6]);
  });

  test('keeps straight subdivisions in compound meters', () => {
    expect(stepsOf([0, 160, 320], [bar(0, 6, 8)])).toEqual([6, 6]);
    expect(stepsOf([0, 60, 120], [bar(0, 6, 8)])).toEqual([3, 6]);
  });

  test('chooses sixteenth-note triplets in the last eighth of a bar', () => {
    expect(stepsOf([480, 560, 640], [bar(0, 3, 8)])).toEqual([6, 4]);
  });

  test('allows for triplets rounded to whole ticks at any resolution', () => {
    const bar100 = { ...bar(0), ticks: 400 };
    const steps = buildBeats([0, 33, 67, 100, 117, 133], [bar100], 100 / 24, NO_SWING);
    expect(steps.map((b) => b.step)).toEqual([8, 4, 6, 6]);
  });

  test('keeps quarter-note triplets in an eighth-note shuffle', () => {
    const swing = { eighths: true, sixteenths: false };
    expect(stepsOf([0, 320, 640, 960, 1280], [bar(0)], swing)).toEqual([8, 8, 12, 6]);
  });

  test('writes swung notes straight in a shuffle', () => {
    expect(
      stepsOf([0, 320, 480, 640, 800], [bar(0)], { eighths: true, sixteenths: false }),
    ).toEqual([12, 8, 6, 6]);
    expect(
      stepsOf([0, 160, 240, 400, 480, 560], [bar(0)], { eighths: false, sixteenths: true }),
    ).toEqual([6, 4, 6, 6]);
  });
});

describe('snapToBeats', () => {
  test('rounds each tick to the grid of its beat', () => {
    const beats = buildBeats([0, 160, 320, 480, 600], [bar(0)], GRID, NO_SWING);
    const snap = (tick: number) => snapToBeats(beats, tick / GRID);
    expect([0, 150, 330, 470, 610, 700].map(snap)).toEqual([0, 8, 16, 24, 30, 36]);
  });
});

describe('detectSwing', () => {
  const notes = (ticks: number[], channel = 0) =>
    ticks.map((startTick) => ({ channel, startTick }));
  const beats = (count: number, offsets: number[]) =>
    Array.from({ length: count }, (_, i) => offsets.map((o) => i * 480 + o)).flat();

  test('finds a sixteenth-note shuffle', () => {
    expect(detectSwing(notes(beats(16, [0, 160, 240, 400])), GRID)).toEqual({
      eighths: false,
      sixteenths: true,
    });
  });

  test('finds an eighth-note shuffle', () => {
    expect(detectSwing(notes(beats(16, [0, 320])), GRID)).toEqual({
      eighths: true,
      sixteenths: false,
    });
  });

  test('ignores a few swung beats among straight ones', () => {
    const swung = notes(beats(16, [0, 160, 240, 400]));
    const straight = notes(beats(40, [0, 120, 240, 360]), 1);
    expect(detectSwing([...swung, ...straight], GRID)).toEqual(NO_SWING);
  });

  test('does not take triplets for a shuffle', () => {
    expect(detectSwing(notes(beats(32, [0, 160, 320])), GRID)).toEqual(NO_SWING);
  });

  test('does not take quarter-note triplets for an eighth-note shuffle', () => {
    const quarterTriplets = Array.from({ length: 16 }, (_, i) =>
      [0, 320, 640].map((o) => i * 960 + o),
    ).flat();
    expect(detectSwing(notes(quarterTriplets), GRID)).toEqual(NO_SWING);
  });
});
