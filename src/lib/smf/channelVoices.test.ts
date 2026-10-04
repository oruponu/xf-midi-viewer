import { describe, expect, test } from 'bun:test';
import { activeVoiceIndex, buildChannelParts } from './channelVoices.ts';
import type { ChannelPart } from './channelVoices.ts';
import type { PlaybackMidiMessage } from './playback.ts';

const at = (tick: number, data: number[]): PlaybackMidiMessage => ({
  tick,
  seconds: tick / 960,
  data,
});

const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
const XG_PART_PREFIX = [0xf0, 0x43, 0x10, 0x4c, 0x08];
const partMode = (part: number, mode: number) => [...XG_PART_PREFIX, part, 0x07, mode, 0xf7];

function partOf(parts: ChannelPart[], channel: number): ChannelPart {
  const part = parts.find((p) => p.channel === channel);
  if (!part) throw new Error(`channel ${channel} not found`);
  return part;
}

function lastVoice(part: ChannelPart) {
  return part.voices.at(-1)!;
}

describe('buildChannelParts', () => {
  test('lists only channels with note-ons, starting from the XG initial voices', () => {
    const parts = buildChannelParts([
      at(0, [0x90, 60, 100]),
      at(0, [0x99, 36, 100]),
      at(0, [0xc2, 5]),
    ]);

    expect(parts.map((p) => p.channel)).toEqual([0, 9]);
    expect(partOf(parts, 0).voices).toEqual([
      { tick: 0, seconds: 0, bankMSB: 0, bankLSB: 0, program: 0, isDrum: false },
    ]);
    expect(partOf(parts, 9).voices).toEqual([
      { tick: 0, seconds: 0, bankMSB: 127, bankLSB: 0, program: 0, isDrum: true },
    ]);
  });

  test('applies bank select on the next program change', () => {
    const parts = buildChannelParts([
      at(0, [0xb0, 0, 0]),
      at(0, [0xb0, 32, 18]),
      at(10, [0xc0, 0]),
      at(20, [0xb0, 32, 40]),
      at(30, [0x90, 60, 100]),
    ]);

    const voices = partOf(parts, 0).voices;
    expect(voices).toHaveLength(2);
    expect(voices[1]).toEqual({
      tick: 10,
      seconds: 10 / 960,
      bankMSB: 0,
      bankLSB: 18,
      program: 0,
      isDrum: false,
    });
  });

  test('treats bank MSB 126 and 127 as drums', () => {
    const parts = buildChannelParts([
      at(0, [0xb1, 0, 127]),
      at(0, [0xc1, 8]),
      at(0, [0xb2, 0, 126]),
      at(0, [0xc2, 0]),
      at(10, [0x91, 36, 100]),
      at(10, [0x92, 36, 100]),
    ]);

    expect(lastVoice(partOf(parts, 1))).toMatchObject({ bankMSB: 127, program: 8, isDrum: true });
    expect(lastVoice(partOf(parts, 2))).toMatchObject({ bankMSB: 126, program: 0, isDrum: true });
  });

  test('resets every channel on a reset SysEx', () => {
    const parts = buildChannelParts([
      at(0, [0xb0, 32, 18]),
      at(0, [0xc0, 5]),
      at(0, [0xb9, 0, 0]),
      at(0, [0xc9, 3]),
      at(100, XG_SYSTEM_ON),
      at(200, [0x90, 60, 100]),
      at(200, [0x99, 36, 100]),
    ]);

    expect(lastVoice(partOf(parts, 0))).toEqual({
      tick: 100,
      seconds: 100 / 960,
      bankMSB: 0,
      bankLSB: 0,
      program: 0,
      isDrum: false,
    });
    expect(lastVoice(partOf(parts, 9))).toMatchObject({ tick: 100, bankMSB: 127, isDrum: true });
  });

  test('keeps the bank selected before a reset from leaking into the next program change', () => {
    const parts = buildChannelParts([
      at(0, [0xb0, 32, 18]),
      at(10, XG_SYSTEM_ON),
      at(20, [0xc0, 0]),
      at(30, [0x90, 60, 100]),
    ]);

    expect(lastVoice(partOf(parts, 0))).toMatchObject({ bankLSB: 0, program: 0 });
  });

  test('switches drum mode with an XG Part Mode SysEx', () => {
    const parts = buildChannelParts([
      at(0, [0xc1, 0]),
      at(10, partMode(1, 2)),
      at(20, [0xb1, 0, 0]),
      at(20, [0xc1, 8]),
      at(30, partMode(1, 0)),
      at(40, [0x91, 60, 100]),
    ]);

    expect(partOf(parts, 1).voices.map((v) => [v.tick, v.program, v.isDrum])).toEqual([
      [0, 0, false],
      [0, 0, false],
      [10, 0, true],
      [20, 8, true],
      [30, 8, false],
    ]);
  });

  test('lets an explicit Normal Part Mode override a drum bank until the next drum bank', () => {
    const parts = buildChannelParts([
      at(10, partMode(9, 0)),
      at(20, [0xc9, 0]),
      at(30, [0xb9, 0, 127]),
      at(30, [0xc9, 8]),
      at(40, [0x99, 36, 100]),
    ]);

    expect(partOf(parts, 9).voices.map((v) => [v.tick, v.bankMSB, v.isDrum])).toEqual([
      [0, 127, true],
      [10, 127, false],
      [20, 127, false],
      [30, 127, true],
    ]);
  });

  test('keeps the previous drum kit for a kit outside XG Level 1', () => {
    const parts = buildChannelParts([
      at(0, [0xc9, 86]),
      at(10, [0xc9, 8]),
      at(20, [0xc9, 86]),
      at(30, XG_SYSTEM_ON),
      at(40, [0xc9, 86]),
      at(50, [0x99, 36, 100]),
    ]);

    expect(partOf(parts, 9).voices.map((v) => [v.tick, v.program])).toEqual([
      [0, 0],
      [0, 0],
      [10, 8],
      [20, 8],
      [30, 0],
      [40, 0],
    ]);
  });

  test('restores the received program when a drum part returns to normal mode', () => {
    const parts = buildChannelParts([
      at(0, [0xc1, 5]),
      at(10, partMode(1, 1)),
      at(20, partMode(1, 0)),
      at(30, [0x91, 60, 100]),
    ]);

    expect(partOf(parts, 1).voices.map((v) => [v.tick, v.program, v.isDrum])).toEqual([
      [0, 0, false],
      [0, 5, false],
      [10, 0, true],
      [20, 5, false],
    ]);
  });

  test('keeps a previous SFX kit for a drum kit outside XG Level 1', () => {
    const parts = buildChannelParts([
      at(0, [0xb9, 0, 126]),
      at(0, [0xc9, 1]),
      at(10, [0xb9, 0, 127]),
      at(10, [0xc9, 86]),
      at(20, [0x99, 36, 100]),
    ]);

    expect(lastVoice(partOf(parts, 9))).toMatchObject({
      tick: 10,
      bankMSB: 126,
      program: 1,
      isDrum: true,
    });
  });

  test('keeps an unknown SFX kit as received', () => {
    const parts = buildChannelParts([
      at(0, [0xb2, 0, 126]),
      at(0, [0xc2, 5]),
      at(10, [0x92, 36, 100]),
    ]);

    expect(lastVoice(partOf(parts, 2))).toMatchObject({ bankMSB: 126, program: 5, isDrum: true });
  });

  test('records the first note-on and ignores note-ons with velocity 0', () => {
    const parts = buildChannelParts([
      at(5, [0x91, 60, 0]),
      at(50, [0x91, 60, 100]),
      at(60, [0x92, 60, 0]),
    ]);

    expect(parts.map((p) => p.channel)).toEqual([1]);
    expect(partOf(parts, 1).firstNoteSeconds).toBe(50 / 960);
  });
});

describe('activeVoiceIndex', () => {
  test('uses the voice at the first note-on before that note', () => {
    const [part] = buildChannelParts([
      at(480, [0xc0, 5]),
      at(960, [0x90, 60, 100]),
      at(1920, [0xc0, 6]),
    ]);

    expect(activeVoiceIndex(part!, 0)).toBe(1);
    expect(activeVoiceIndex(part!, 1.5)).toBe(1);
    expect(activeVoiceIndex(part!, 2)).toBe(2);
  });

  test('counts a program change sent before the first note-on at the same tick', () => {
    const [part] = buildChannelParts([at(960, [0xc0, 5]), at(960, [0x90, 60, 100])]);

    expect(part!.firstNoteVoiceIndex).toBe(1);
    expect(activeVoiceIndex(part!, 0)).toBe(1);
  });

  test('does not count a program change sent after the first note-on at the same tick', () => {
    const [part] = buildChannelParts([
      at(480, [0xc0, 3]),
      at(960, [0x90, 60, 100]),
      at(960, [0xc0, 5]),
    ]);

    expect(part!.firstNoteVoiceIndex).toBe(1);
    expect(activeVoiceIndex(part!, 0)).toBe(1);
    expect(activeVoiceIndex(part!, 1)).toBe(2);
  });

  test('moves when only the bank or the drum mode changes', () => {
    const [part] = buildChannelParts([
      at(0, [0xc0, 0]),
      at(0, [0x90, 60, 100]),
      at(960, [0xb0, 32, 18]),
      at(960, [0xc0, 0]),
      at(1920, partMode(0, 1)),
    ]);

    const a = activeVoiceIndex(part!, 0.5);
    const b = activeVoiceIndex(part!, 1.5);
    const c = activeVoiceIndex(part!, 2.5);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(part!.voices[b]).toMatchObject({ bankLSB: 18, program: 0, isDrum: false });
    expect(part!.voices[c]).toMatchObject({ bankLSB: 18, program: 0, isDrum: true });
  });
});
