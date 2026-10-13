// Usage: bun scripts/xg-soundfont/calibration/calibrateRanges.ts <range reference levels json>
// Rewrites only the ranges of corrections.json, and only when every voice is measured and fitted.
import { readFileSync } from 'node:fs';
import { SpessaLog } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { rangeLimits } from './apply.ts';
import { rangeOffsets } from './ranges.ts';
import type { AttenuationLimit } from './apply.ts';
import { readCorrections, writeCorrections } from './corrections.ts';
import type { RangeCorrection, RangeKey } from './corrections.ts';
import { ATTENUATION_PER_DB, errorStats } from './fit.ts';
import type { ErrorStats } from './fit.ts';
import { SILENT_DB, voiceLevelKey } from './levels.ts';
import type { Level, LevelTable } from './levels.ts';
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
const WORST_COUNT = 20;

type Levels = Readonly<Record<string, Level>>;
const voiceKey = (v: VoiceId) => `${v.bankMSB}/${v.program}`;
const label = (v: VoiceId) => `voice ${voiceKey(v)}`;
const isLevel = (value: Level | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= SILENT_DB;

function index(table: LevelTable): Map<string, Levels> {
  const map = new Map<string, Levels>();
  for (const v of table.voices) if (!v.bankLSB) map.set(voiceKey(v), v.levels);
  return map;
}

interface Unit {
  readonly voice: VoiceId;
  readonly note: number;
  readonly key: RangeKey;
  readonly points: readonly string[];
  readonly reference: Levels;
  readonly limit: AttenuationLimit;
}

export function calibrateRanges(input: RangeCalibrationInput): RangeCalibrationResult {
  const log = input.log ?? (() => {});
  const maxIterations = input.maxIterations ?? 5;
  const reference = index(input.reference);
  const m0 = index(input.measure([]));
  const ranges: RangeCorrection[] = [];
  const units: Unit[] = [];
  const unmeasured: string[] = [];
  let unmeasuredNotes = 0;
  for (const voice of input.voices) {
    const ref = reference.get(voiceKey(voice));
    const now = m0.get(voiceKey(voice));
    if (!ref) throw new Error(`${label(voice)} is missing from the reference`);
    if (!now) throw new Error(`${label(voice)} is missing from the measurement`);
    const keys: RangeKey[] = [];
    for (const note of input.notes) {
      const points = input.velocities.map((velocity) => voiceLevelKey(note, velocity));
      for (const [table, where] of [
        [ref, 'reference'],
        [now, 'measurement'],
      ] as const) {
        for (const p of points) {
          if (!(p in table))
            throw new Error(`${label(voice)}: point ${p} is missing from the ${where}`);
        }
      }
      const valid = points.filter((p) => isLevel(ref[p]) && isLevel(now[p]));
      if (valid.length === 0) {
        unmeasuredNotes++;
        continue;
      }
      const key: RangeKey = { key: note, attenuationDelta: 0 };
      keys.push(key);
      units.push({
        voice,
        note,
        key,
        points: valid,
        reference: ref,
        limit: input.limit(voice, note),
      });
    }
    if (keys.length === 0) unmeasured.push(label(voice));
    else ranges.push({ bankMSB: voice.bankMSB, program: voice.program, keys });
  }

  const errors = (m: Map<string, Levels>, u: Unit): number[] => {
    const levels = m.get(voiceKey(u.voice)) ?? {};
    return u.points.map((p) => {
      const value = levels[p];
      if (!isLevel(value)) {
        throw new Error(`${label(u.voice)} point ${p} can no longer be measured`);
      }
      return (u.reference[p] as number) - input.shiftDb - value;
    });
  };
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const outOfRange = new Map<Unit, string>();
  // The build would throw on these, so the fit stops before measuring them.
  const between: string[] = [];
  const interpolatedOutOfRange = () =>
    ranges.flatMap((r) =>
      rangeOffsets(r.keys, label(r)).flatMap((delta, note) => {
        const l = input.limit(r, note);
        return delta < l.min || delta > l.max
          ? [`${label(r)} note ${note}: interpolated ${delta} cB, allowed ${l.min} to ${l.max}`]
          : [];
      }),
    );
  let m = m0;
  let largest: number;
  for (let iteration = 0; ; iteration++) {
    const residuals = units.map((u) => mean(errors(m, u)));
    largest = Math.max(0, ...residuals.map(Math.abs));
    log(`iteration ${iteration}: largest residual ${largest.toFixed(2)} dB`);
    if (largest <= TOLERANCE_DB || iteration === maxIterations) break;
    units.forEach((u, i) => {
      const wanted = u.key.attenuationDelta - Math.round(residuals[i] * ATTENUATION_PER_DB);
      const allowed = Math.min(u.limit.max, Math.max(u.limit.min, wanted));
      if (allowed !== wanted) {
        outOfRange.set(
          u,
          `${label(u.voice)} note ${u.note}: needs ${wanted} cB, allowed ${u.limit.min} to ${u.limit.max}`,
        );
      }
      u.key.attenuationDelta = allowed;
    });
    between.push(...interpolatedOutOfRange());
    if (between.length > 0) break;
    m = index(input.measure(ranges));
  }

  const unitErrors = units.map((u) => ({ u, errors: errors(m, u) }));
  const byVoice = new Map<string, number[]>();
  for (const { u, errors: e } of unitErrors) {
    const list = byVoice.get(label(u.voice)) ?? [];
    list.push(...e.map(Math.abs));
    byVoice.set(label(u.voice), list);
  }
  const worst = [...byVoice]
    .map(([unit, e]) => ({ unit, errorDb: mean(e) }))
    .sort((a, b) => b.errorDb - a.errorDb)
    .slice(0, WORST_COUNT);
  return {
    ranges,
    points: errorStats(unitErrors.flatMap((x) => x.errors)),
    largestResidualDb: largest,
    unmeasured,
    unmeasuredNotes,
    outOfRange: [...outOfRange.values(), ...between],
    passed:
      unmeasured.length === 0 &&
      outOfRange.size === 0 &&
      between.length === 0 &&
      largest <= TOLERANCE_DB,
    worst,
  };
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
  const s = result.points;
  console.log(
    `points: n=${s.count} median ${s.median.toFixed(2)} p90 ${s.p90.toFixed(2)} max ${s.max.toFixed(2)} dB`,
  );
  console.log(`largest residual ${result.largestResidualDb.toFixed(2)} dB`);
  console.log(
    `unmeasured: ${result.unmeasured.join(', ') || '-'}, unmeasured notes ${result.unmeasuredNotes}`,
  );
  for (const line of result.outOfRange) console.log(`out of range: ${line}`);
  for (const w of result.worst) console.log(`  ${w.unit}: ${w.errorDb.toFixed(2)} dB`);
  if (!result.passed) {
    console.error(
      'A voice is unmeasured, out of range or outside the tolerance; corrections.json was not written',
    );
    process.exit(1);
  }
  writeCorrections(CORRECTIONS_PATH, { ...existing, ranges: result.ranges });
  console.log('Run calibrateVariations.ts --check and outputGain.ts next');
}
