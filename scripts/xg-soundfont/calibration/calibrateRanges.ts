// Usage: bun scripts/xg-soundfont/calibration/calibrateRanges.ts <range reference levels json>
// Rewrites only the ranges of corrections.json, and only when every measured note fits or is held
// at its limits. Voices without measurable notes keep their level without a range correction.
import { readFileSync } from 'node:fs';
import { SpessaLog } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { rangeLimits } from './apply.ts';
import { rangeOffsets } from './ranges.ts';
import type { AttenuationLimit } from './apply.ts';
import { readCorrections, writeCorrections } from './corrections.ts';
import type { RangeCorrection } from './corrections.ts';
import { ATTENUATION_PER_DB } from './fit.ts';
import type { ErrorStats } from './fit.ts';
import type { LevelTable } from './levels.ts';
import { fitRanges, logRangeFit } from './rangeFit.ts';
import type { RangeFit } from './rangeFit.ts';
import { measureBank, sf3DecoderReady } from './render.ts';
import { RANGE_NOTES, VOICE_VELOCITIES } from './testMidi.ts';
import type { VoiceId } from './testMidi.ts';

export interface RangeCalibrationInput {
  readonly voices: readonly VoiceId[];
  readonly notes: readonly number[];
  readonly velocities: readonly number[];
  readonly reference: LevelTable;
  readonly shiftDb: number;
  readonly limit: (voice: VoiceId, note: number) => AttenuationLimit;
  readonly measure: (ranges: readonly RangeCorrection[]) => LevelTable;
  readonly maxIterations?: number;
  readonly log?: (message: string) => void;
}

export interface RangeCalibrationResult {
  readonly ranges: RangeCorrection[];
  readonly points: ErrorStats;
  readonly largestResidualDb: number;
  readonly unmeasured: readonly string[];
  readonly unmeasuredNotes: number;
  readonly outOfRange: readonly string[];
  readonly passed: boolean;
  readonly worst: readonly { unit: string; errorDb: number }[];
}

const TOLERANCE_DB = 0.1;
const label = (v: VoiceId) => `voice ${v.bankMSB}/${v.program}`;

export function calibrateRanges(input: RangeCalibrationInput): RangeCalibrationResult {
  const toRanges = (fits: readonly RangeFit[]): RangeCorrection[] =>
    fits.map(({ voice, keys }) => ({ bankMSB: voice.bankMSB, program: voice.program, keys }));
  const { fits, ...result } = fitRanges({
    voices: input.voices,
    label,
    notes: input.notes,
    velocities: input.velocities,
    reference: input.reference,
    shiftDb: input.shiftDb,
    limit: input.limit,
    offsets: rangeOffsets,
    step: 1,
    toleranceDb: TOLERANCE_DB,
    measure: (f) => input.measure(toRanges(f)),
    maxIterations: input.maxIterations,
    log: input.log,
  });
  return { ...result, ranges: toRanges(fits) };
}

if (import.meta.main) {
  const [referencePath] = process.argv.slice(2);
  if (!referencePath) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/calibrateRanges.ts <range reference levels json>',
    );
    process.exit(2);
  }
  SpessaLog.setLogLevel(false, false, false);
  await sf3DecoderReady();
  const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
  const existing = readCorrections(CORRECTIONS_PATH);
  const voices: VoiceId[] = existing.voices.map(({ bankMSB, program }) => ({ bankMSB, program }));
  let count = 0;
  const result = calibrateRanges({
    voices,
    notes: RANGE_NOTES,
    velocities: VOICE_VELOCITIES,
    reference: JSON.parse(readFileSync(referencePath, 'utf8')) as LevelTable,
    shiftDb: existing.commonAttenuation / ATTENUATION_PER_DB,
    limit: rangeLimits(buildXgBank(source, { ...existing, ranges: [] })),
    measure: (ranges) => {
      console.log(`measure ${++count}`);
      return measureBank(buildXgBank(source, { ...existing, ranges: [...ranges] }), {
        kits: [],
        voices,
        notes: RANGE_NOTES,
      });
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
  writeCorrections(CORRECTIONS_PATH, { ...existing, ranges: result.ranges });
  console.log('Run calibrateVariations.ts --check and outputGain.ts next');
}
