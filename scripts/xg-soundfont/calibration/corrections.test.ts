import { describe, expect, test } from 'bun:test';
import { SpessaLog } from 'spessasynth_core';
import { BUNDLED_SOUND_BANK_GAIN_DB } from '../../../src/lib/synth/soundBank.ts';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { listUnits } from './apply.ts';
import { NO_CORRECTIONS, readCorrections } from './corrections.ts';
import type { ExcludedUnit } from './corrections.ts';

describe('corrections.json', () => {
  test('keeps the app gain for the bundled sound bank in sync', () => {
    expect(BUNDLED_SOUND_BANK_GAIN_DB).toBe(readCorrections(CORRECTIONS_PATH).outputGainDb);
  });

  test('covers every unit of the sound bank', () => {
    SpessaLog.setLogLevel(false, false, false);
    const units = listUnits(buildXgBank(readSoundBank(SOURCE_SOUND_BANK_PATH), NO_CORRECTIONS));
    const corrections = readCorrections(CORRECTIONS_PATH);
    const ids = (list: readonly ExcludedUnit[]) =>
      list
        .map((u) => ('kit' in u ? `drum ${u.kit}/${u.key}` : `voice ${u.bankMSB}/${u.program}`))
        .sort();
    expect(ids([...corrections.drums, ...corrections.voices, ...corrections.excluded])).toEqual(
      ids([...units.drums, ...units.voices]),
    );
  });
});
