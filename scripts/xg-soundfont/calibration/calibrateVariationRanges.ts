// Usage: bun scripts/xg-soundfont/calibration/calibrateVariationRanges.ts <variation range reference levels json>
// Rewrites only the variation ranges of corrections.json, and only when every measured note fits or
// is held at its limit.
import { readFileSync } from 'node:fs';
import { SpessaLog } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { XG_VARIATION_VOICES } from '../xgVariationVoices.ts';
import { variationRangeLimits } from './apply.ts';
import type { AttenuationLimit } from './apply.ts';
import type { VariationId } from './calibrateVariations.ts';
import { readCorrections, writeCorrections } from './corrections.ts';
import type { VariationRangeCorrection } from './corrections.ts';
import { ATTENUATION_PER_DB } from './fit.ts';
import type { LevelTable } from './levels.ts';
import { fitRanges, logRangeFit } from './rangeFit.ts';
import type { RangeFit, RangeFitResult } from './rangeFit.ts';
import { VARIATION_RANGE_STEP, steppedRangeOffsets } from './ranges.ts';
import { measureBank, sf3DecoderReady } from './render.ts';
import { RANGE_NOTES, VOICE_VELOCITIES } from './testMidi.ts';
import type { VoiceId } from './testMidi.ts';

type VariationKey = { readonly bankLSB: number; readonly program: number };

export interface VariationRangeCalibrationInput {
  readonly variations: readonly VariationId[];
  readonly notes: readonly number[];
  readonly velocities: readonly number[];
  readonly reference: LevelTable;
  readonly shiftDb: number;
  readonly limit: (variation: VariationKey, note: number) => AttenuationLimit;
  readonly measure: (variationRanges: readonly VariationRangeCorrection[]) => LevelTable;
  readonly maxIterations?: number;
  readonly log?: (message: string) => void;
}

export interface VariationRangeCalibrationResult extends Omit<RangeFitResult, 'fits'> {
  readonly variationRanges: VariationRangeCorrection[];
}

// The build rounds each delta to the step, so the fit cannot get closer than half of it.
export const VARIATION_RANGE_TOLERANCE_DB = VARIATION_RANGE_STEP / ATTENUATION_PER_DB / 2;

export function calibrateVariationRanges(
  input: VariationRangeCalibrationInput,
): VariationRangeCalibrationResult {
  const names = new Map(input.variations.map((v) => [`${v.bankLSB}/${v.program}`, v.name]));
  const keyOf = (v: VoiceId): VariationKey => ({ bankLSB: v.bankLSB ?? 0, program: v.program });
  const label = (v: VoiceId) => {
    const { bankLSB, program } = keyOf(v);
    return `${names.get(`${bankLSB}/${program}`)} (LSB ${bankLSB} / PC ${program})`;
  };
  const toCorrections = (fits: readonly RangeFit[]): VariationRangeCorrection[] =>
    fits.map(({ voice, keys }) => ({ ...keyOf(voice), keys }));
  const { fits, ...result } = fitRanges({
    voices: input.variations.map(({ bankLSB, program }) => ({ bankMSB: 0, bankLSB, program })),
    label,
    notes: input.notes,
    velocities: input.velocities,
    reference: input.reference,
    shiftDb: input.shiftDb,
    limit: (v, note) => input.limit(keyOf(v), note),
    offsets: (keys, where) => steppedRangeOffsets(keys, where, VARIATION_RANGE_STEP),
    step: VARIATION_RANGE_STEP,
    toleranceDb: VARIATION_RANGE_TOLERANCE_DB,
    measure: (f) => input.measure(toCorrections(f)),
    maxIterations: input.maxIterations,
    log: input.log,
  });
  return { ...result, variationRanges: toCorrections(fits) };
}

if (import.meta.main) {
  const [referencePath] = process.argv.slice(2);
  if (!referencePath) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/calibrateVariationRanges.ts <variation range reference levels json>',
    );
    process.exit(2);
  }
  SpessaLog.setLogLevel(false, false, false);
  await sf3DecoderReady();
  const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
  const existing = readCorrections(CORRECTIONS_PATH);
  const voices: VoiceId[] = XG_VARIATION_VOICES.map(({ bankLSB, program }) => ({
    bankMSB: 0,
    bankLSB,
    program,
  }));
  let count = 0;
  const result = calibrateVariationRanges({
    variations: XG_VARIATION_VOICES,
    notes: RANGE_NOTES,
    velocities: VOICE_VELOCITIES,
    reference: JSON.parse(readFileSync(referencePath, 'utf8')) as LevelTable,
    shiftDb: existing.commonAttenuation / ATTENUATION_PER_DB,
    limit: variationRangeLimits(buildXgBank(source, { ...existing, variationRanges: [] })),
    measure: (variationRanges) => {
      console.log(`measure ${++count}`);
      return measureBank(
        buildXgBank(source, { ...existing, variationRanges: [...variationRanges] }),
        { kits: [], voices, notes: RANGE_NOTES },
      );
    },
    log: console.log,
  });
  logRangeFit(result, console.log);
  if (!result.passed) {
    console.error(
      'An interpolated note leaves its limits or a residual is outside the tolerance; corrections.json was not written',
    );
    process.exit(1);
  }
  writeCorrections(CORRECTIONS_PATH, { ...existing, variationRanges: result.variationRanges });
  console.log('Run calibrateVariations.ts --check and outputGain.ts next');
}
