import { beforeAll, describe, expect, test } from 'bun:test';
import { SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import { markerShift } from './levels.ts';
import { measureBank, renderMessages, sf3DecoderReady } from './render.ts';
import { drumTestMidi } from './testMidi.ts';

SpessaLog.setLogLevel(false, false, false);

let bank: BasicSoundBank;
beforeAll(async () => {
  await sf3DecoderReady();
  bank = buildXgBank(readSoundBank(SOURCE_SOUND_BANK_PATH), NO_CORRECTIONS);
});

describe('renderMessages', () => {
  test('renders the marker at its scheduled time and tracks the peak', () => {
    const midi = drumTestMidi([0], [36], [100]);
    const { energy, peak } = renderMessages(bank, midi.messages, midi.endSeconds);
    expect(Math.abs(markerShift(energy, midi))).toBeLessThan(0.01);
    expect(peak).toBeGreaterThan(0);
  });
});

describe('measureBank', () => {
  test('measures louder hits for higher velocities', () => {
    const table = measureBank(bank, {
      kits: [0],
      keys: [36],
      drumVelocities: [32, 127],
      voices: [],
    });
    const [kick] = table.drums;
    expect(kick.levels['127']!).toBeGreaterThan(kick.levels['32']! + 6);
    expect(table.voices).toEqual([]);
  });

  test('keeps the previous long sound out of the next measurement', () => {
    const alone = measureBank(bank, { kits: [0], keys: [42], drumVelocities: [24], voices: [] });
    const afterCrash = measureBank(bank, {
      kits: [0],
      keys: [49, 42],
      drumVelocities: [24, 127],
      voices: [],
    });
    expect(afterCrash.drums[1].levels['24']! - alone.drums[0].levels['24']!).toBeCloseTo(0, 1);

    const pad = { bankMSB: 0, program: 89 };
    const padAlone = measureBank(bank, {
      kits: [],
      voices: [pad],
      notes: [48],
      voiceVelocities: [40],
    });
    const afterLoud = measureBank(bank, {
      kits: [],
      voices: [pad],
      notes: [48],
      voiceVelocities: [127, 40],
    });
    expect(afterLoud.voices[0].levels['48/40']! - padAlone.voices[0].levels['48/40']!).toBeCloseTo(
      0,
      1,
    );
  });

  test('measures voice notes', () => {
    const table = measureBank(bank, {
      kits: [],
      voices: [{ bankMSB: 0, program: 0 }],
      notes: [60],
      voiceVelocities: [40, 127],
    });
    const [piano] = table.voices;
    expect(piano.levels['60/127']!).toBeGreaterThan(piano.levels['60/40']!);
    expect(table.drums).toEqual([]);
  });
});
