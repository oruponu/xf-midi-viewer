// Usage: bun scripts/xg-soundfont/calibration/calibrateVariations.ts <variation reference levels json> [residuals out json]
// Rewrites only the variations of corrections.json, and only when every variation is measured and fitted.
import { readFileSync, writeFileSync } from 'node:fs';
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

export interface VariationResidual {
  readonly program: number;
  readonly bankLSB: number;
  readonly meanDb: number;
}

export interface VariationCalibrationResult {
  readonly variations: VariationCorrection[];
  readonly points: ErrorStats;
  readonly means: ErrorStats;
  readonly residuals: readonly VariationResidual[];
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
    residuals: units.map((u, i) => ({
      program: u.correction.program,
      bankLSB: u.correction.bankLSB,
      meanDb: Math.round(means[i] * 1000) / 1000,
    })),
    passed: unmeasured.length === 0 && means.every((x) => Math.abs(x) <= TOLERANCE_DB),
    unmeasured,
    worst,
  };
}

export interface VariationChange {
  readonly program: number;
  readonly bankLSB: number;
  readonly beforeDb: number;
  readonly afterDb: number | null;
  readonly lostPoints: number;
}

// Each variation's mean residual before and after, on the points measured in both; if none,
// before uses its own points and afterDb is null.
export function variationChanges(
  variations: readonly VariationId[],
  reference: LevelTable,
  before: LevelTable,
  after: LevelTable,
): VariationChange[] {
  const ref = index(reference);
  const tables = [index(before), index(after)];
  const changes: VariationChange[] = [];
  for (const v of variations) {
    const rv = ref.get(voiceKey(v.bankLSB, v.program));
    const rb = ref.get(voiceKey(0, v.program));
    const sides = tables.map((t) => [
      t.get(voiceKey(0, v.program)),
      t.get(voiceKey(v.bankLSB, v.program)),
    ]);
    if (!rv || !rb || sides.flat().some((t) => !t)) {
      throw new Error(`${label(v)} is missing from the tables`);
    }
    const valid = sides.map(([b, m]) =>
      Object.keys(rv).filter(
        (k) => isLevel(rv[k]) && isLevel(rb[k]) && isLevel(b![k]) && isLevel(m![k]),
      ),
    );
    if (valid[0].length === 0) continue;
    const common = valid[0].filter((k) => valid[1].includes(k));
    const meanOf = ([b, m]: readonly (Levels | undefined)[], keys: readonly string[]) =>
      keys.reduce(
        (sum, k) =>
          sum + (b![k] as number) + (rv[k] as number) - (rb[k] as number) - (m![k] as number),
        0,
      ) / keys.length;
    changes.push({
      program: v.program,
      bankLSB: v.bankLSB,
      beforeDb: meanOf(sides[0], common.length > 0 ? common : valid[0]),
      afterDb: common.length > 0 ? meanOf(sides[1], common) : null,
      lostPoints: valid[0].length - common.length,
    });
  }
  return changes;
}

if (import.meta.main) {
  if (process.argv[2] === '--check') {
    const referencePath = process.argv[3];
    if (!referencePath) {
      console.error(
        'Usage: bun scripts/xg-soundfont/calibration/calibrateVariations.ts --check <variation reference levels json>',
      );
      process.exit(2);
    }
    SpessaLog.setLogLevel(false, false, false);
    await sf3DecoderReady();
    const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
    const corrections = readCorrections(CORRECTIONS_PATH);
    const programs = [...new Set(XG_VARIATION_VOICES.map((v) => v.program))];
    const ids: VoiceId[] = [
      ...programs.map((program) => ({ bankMSB: 0, program })),
      ...XG_VARIATION_VOICES.map(({ program, bankLSB }) => ({ bankMSB: 0, bankLSB, program })),
    ];
    const measure = (c: typeof corrections) =>
      measureBank(buildXgBank(source, c), { kits: [], voices: ids });
    const changes = variationChanges(
      XG_VARIATION_VOICES,
      JSON.parse(readFileSync(referencePath, 'utf8')) as LevelTable,
      measure({ ...corrections, ranges: [] }),
      measure(corrections),
    );
    const lost = changes.filter((c) => c.lostPoints > 0);
    const moved = changes.filter(
      (c) => c.afterDb !== null && Math.abs(c.afterDb - c.beforeDb) > 0.01,
    );
    console.log(`checked ${changes.length} variations, moved ${moved.length}, lost ${lost.length}`);
    for (const c of moved) {
      console.log(
        `  moved LSB ${c.bankLSB} / PC ${c.program}: ${(c.afterDb! - c.beforeDb).toFixed(3)} dB`,
      );
    }
    for (const c of lost) {
      console.log(`  lost ${c.lostPoints} points of LSB ${c.bankLSB} / PC ${c.program}`);
    }
    process.exit(moved.length === 0 && lost.length === 0 ? 0 : 1);
  }
  const [referencePath, residualsPath] = process.argv.slice(2);
  if (!referencePath) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/calibrateVariations.ts <variation reference levels json> [residuals out json]',
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
    console.error(
      'A variation is unmeasured or outside the tolerance; corrections.json was not written',
    );
    process.exit(1);
  }
  writeCorrections(CORRECTIONS_PATH, { ...existing, variations: result.variations });
  if (residualsPath) writeFileSync(residualsPath, `${JSON.stringify(result.residuals, null, 2)}\n`);
}
