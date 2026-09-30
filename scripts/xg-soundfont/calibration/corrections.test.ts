import { describe, expect, test } from 'bun:test';
import { BUNDLED_SOUND_BANK_GAIN_DB } from '../../../src/lib/synth/soundBank.ts';
import { CORRECTIONS_PATH } from '../paths.ts';
import { readCorrections } from './corrections.ts';

describe('corrections.json', () => {
  test('keeps the app gain for the bundled sound bank in sync', () => {
    expect(BUNDLED_SOUND_BANK_GAIN_DB).toBe(readCorrections(CORRECTIONS_PATH).outputGainDb);
  });
});
