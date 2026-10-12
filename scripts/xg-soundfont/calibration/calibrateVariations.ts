// Usage: bun scripts/xg-soundfont/calibration/calibrateVariations.ts <variation reference levels json>
// Rewrites only the variations of corrections.json, and only when every fit is within the tolerance.
import { readFileSync } from 'node:fs';
import { SpessaLog } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { XG_VARIATION_VOICES } from '../xgVariationVoices.ts';
import { readCorrections, writeCorrections } from './corrections.ts';
import type { VariationCorrection } from './corrections.ts';
import {
  ATTENUATION_PER_DB,
  errorStats,
  meanDifference,
  voiceVelocity,
  voiceVelocityDelta,
} from './fit.ts';
import type { ErrorStats, Point } from './fit.ts';
import { SILENT_DB } from './levels.ts';
import type { Level, LevelTable } from './levels.ts';
import { measureBank, sf3DecoderReady } from './render.ts';
import type { VoiceId } from './testMidi.ts';

export interface VariationId {
  readonly program: number;
  readonly bankLSB: number;
  readonly name: string;
}

export interface VariationCalibrationInput {
  readonly variations: readonly VariationId[];
  readonly reference: LevelTable;
  readonly measure: (variations: readonly VariationCorrection[]) => LevelTable;
  readonly maxIterations?: number;
  readonly log?: (message: string) => void;
}

export interface VariationCalibrationResult {
  readonly variations: VariationCorrection[];
  readonly points: ErrorStats;
  readonly means: ErrorStats;
  readonly passed: boolean;
  readonly unmeasured: readonly string[];
  readonly worst: readonly { unit: string; errorDb: number }[];
}

const TOLERANCE_DB = 0.1;
const WORST_COUNT = 20;

type Levels = Readonly<Record<string, Level>>;
const voiceKey = (bankLSB: number, program: number) => `${bankLSB}/${program}`;
const label = (v: VariationId) => `${v.name} (LSB ${v.bankLSB} / PC ${v.program})`;
const isLevel = (value: Level | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= SILENT_DB;

function index(table: LevelTable): Map<string, Levels> {
  const map = new Map<string, Levels>();
  for (const v of table.voices) {
    if (v.bankMSB === 0) map.set(voiceKey(v.bankLSB ?? 0, v.program), v.levels);
  }
  return map;
}

interface Unit {
  readonly id: string;
  readonly correction: VariationCorrection;
  readonly targets: Readonly<Record<string, number>>;
}

export function calibrateVariations(input: VariationCalibrationInput): VariationCalibrationResult {
  const log = input.log ?? (() => {});
  const maxIterations = input.maxIterations ?? 5;
  const reference = index(input.reference);
  const corrections: VariationCorrection[] = input.variations.map(({ program, bankLSB }) => ({
    program,
    bankLSB,
    attenuationDelta: 0,
    velocityAmountDelta: 0,
  }));

  const m0 = index(input.measure(corrections));
  // A missing table is a broken input; only silent points inside a table are left out.
  for (const v of input.variations) {
    for (const [table, where] of [
      [reference, 'reference'],
      [m0, 'measurement'],
    ] as const) {
      for (const lsb of [0, v.bankLSB]) {
        if (!table.has(voiceKey(lsb, v.program))) {
          throw new Error(`${label(v)}: LSB ${lsb} / PC ${v.program} is missing from the ${where}`);
        }
      }
    }
  }
  const units: Unit[] = [];
  const unmeasured: string[] = [];
  input.variations.forEach((v, i) => {
    const refVariation = reference.get(voiceKey(v.bankLSB, v.program))!;
    const refBase = reference.get(voiceKey(0, v.program))!;
    const base = m0.get(voiceKey(0, v.program))!;
    const now = m0.get(voiceKey(v.bankLSB, v.program))!;
    const expected = Object.keys(refVariation);
    if (expected.length === 0) throw new Error(`${label(v)} has no points in the reference`);
    for (const [table, where] of [
      [refBase, 'reference of the base voice'],
      [base, 'measurement of the base voice'],
      [now, 'measurement of the variation'],
    ] as const) {
      for (const key of expected) {
        if (!(key in table)) {
          throw new Error(`${label(v)}: point ${key} is missing from the ${where}`);
        }
      }
    }
    const targets: Record<string, number> = {};
    for (const key of expected) {
      const rv = refVariation[key];
      const rb = refBase[key];
      const b = base[key];
      if (isLevel(rv) && isLevel(rb) && isLevel(b) && isLevel(now[key])) targets[key] = b + rv - rb;
    }
    if (Object.keys(targets).length === 0) unmeasured.push(label(v));
    else units.push({ id: label(v), correction: corrections[i], targets });
  });

  const points = (m: Map<string, Levels>, u: Unit): Point[] => {
    const levels = m.get(voiceKey(u.correction.bankLSB, u.correction.program)) ?? {};
    return Object.entries(u.targets).map(([key, target]) => {
      const value = levels[key];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        throw new Error(`${u.id} point ${key} can no longer be measured`);
      }
      return { velocity: voiceVelocity(key), reference: target, measured: value };
    });
  };

  // Velocity sensitivity first, since it also moves the average level.
  for (const u of units) u.correction.velocityAmountDelta = voiceVelocityDelta(points(m0, u)) ?? 0;
  let m = index(input.measure(corrections));
  for (let iteration = 0; ; iteration++) {
    const residuals = units.map((u) => meanDifference(points(m, u))!);
    const largest = Math.max(0, ...residuals.map(Math.abs));
    log(`iteration ${iteration}: largest residual ${largest.toFixed(2)} dB`);
    if (largest <= TOLERANCE_DB || iteration === maxIterations) break;
    units.forEach((u, i) => {
      u.correction.attenuationDelta -= Math.round(residuals[i] * ATTENUATION_PER_DB);
    });
    m = index(input.measure(corrections));
  }

  const unitErrors = units.map((u) => ({
    unit: u.id,
    errors: points(m, u).map((p) => p.reference - p.measured),
  }));
  const means = unitErrors.map((u) => u.errors.reduce((s, e) => s + e, 0) / u.errors.length);
  const worst = unitErrors
    .map((u) => ({
      unit: u.unit,
      errorDb: u.errors.reduce((s, e) => s + Math.abs(e), 0) / u.errors.length,
    }))
    .sort((a, b) => b.errorDb - a.errorDb)
    .slice(0, WORST_COUNT);
  return {
    variations: corrections,
    points: errorStats(unitErrors.flatMap((u) => u.errors)),
    means: errorStats(means),
    passed: means.every((x) => Math.abs(x) <= TOLERANCE_DB),
    unmeasured,
    worst,
  };
}

if (import.meta.main) {
  const [referencePath] = process.argv.slice(2);
  if (!referencePath) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/calibrateVariations.ts <variation reference levels json>',
    );
    process.exit(2);
  }
  SpessaLog.setLogLevel(false, false, false);
  await sf3DecoderReady();
  const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
  const existing = readCorrections(CORRECTIONS_PATH);
  const programs = [...new Set(XG_VARIATION_VOICES.map((v) => v.program))];
  const voices: VoiceId[] = [
    ...programs.map((program) => ({ bankMSB: 0, program })),
    ...XG_VARIATION_VOICES.map(({ program, bankLSB }) => ({ bankMSB: 0, bankLSB, program })),
  ];
  let count = 0;
  const result = calibrateVariations({
    variations: XG_VARIATION_VOICES,
    reference: JSON.parse(readFileSync(referencePath, 'utf8')) as LevelTable,
    measure: (variations) => {
      console.log(`measure ${++count}`);
      return measureBank(buildXgBank(source, { ...existing, variations: [...variations] }), {
        kits: [],
        voices,
      });
    },
    log: console.log,
  });
  const show = (name: string, s: ErrorStats) =>
    console.log(
      `${name}: n=${s.count} median ${s.median.toFixed(2)} p90 ${s.p90.toFixed(2)} max ${s.max.toFixed(2)} dB`,
    );
  show('points', result.points);
  show('means', result.means);
  console.log(`unmeasured: ${result.unmeasured.join(', ') || '-'}`);
  for (const w of result.worst) console.log(`  ${w.unit}: ${w.errorDb.toFixed(2)} dB`);
  if (!result.passed) {
    console.error('A variation is outside the tolerance; corrections.json was not written');
    process.exit(1);
  }
  writeCorrections(CORRECTIONS_PATH, { ...existing, variations: result.variations });
}
