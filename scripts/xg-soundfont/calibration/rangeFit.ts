import type { AttenuationLimit } from './apply.ts';
import type { RangeKey } from './corrections.ts';
import { ATTENUATION_PER_DB, errorStats } from './fit.ts';
import type { ErrorStats } from './fit.ts';
import { SILENT_DB, voiceLevelKey } from './levels.ts';
import type { Level, LevelTable } from './levels.ts';
import type { VoiceId } from './testMidi.ts';

export interface RangeFit {
  readonly voice: VoiceId;
  readonly keys: RangeKey[];
}

export interface RangeFitInput {
  readonly voices: readonly VoiceId[];
  readonly label: (voice: VoiceId) => string;
  readonly notes: readonly number[];
  readonly velocities: readonly number[];
  readonly reference: LevelTable;
  readonly shiftDb: number;
  readonly limit: (voice: VoiceId, note: number) => AttenuationLimit;
  readonly offsets: (keys: readonly RangeKey[], where: string) => number[];
  readonly step: number;
  readonly toleranceDb: number;
  readonly measure: (fits: readonly RangeFit[]) => LevelTable;
  readonly maxIterations?: number;
  readonly log?: (message: string) => void;
}

export interface RangeFitResult {
  readonly fits: RangeFit[];
  readonly points: ErrorStats;
  readonly largestResidualDb: number;
  readonly unmeasured: readonly string[];
  readonly unmeasuredNotes: number;
  readonly outOfRange: readonly string[];
  readonly passed: boolean;
  readonly worst: readonly { unit: string; errorDb: number }[];
}

const WORST_COUNT = 20;

type Levels = Readonly<Record<string, Level>>;
const voiceKey = (v: VoiceId) => `${v.bankMSB}/${v.bankLSB ?? 0}/${v.program}`;
const isLevel = (value: Level | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= SILENT_DB;

function index(table: LevelTable): Map<string, Levels> {
  const map = new Map<string, Levels>();
  for (const v of table.voices) map.set(voiceKey(v), v.levels);
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

export function fitRanges(input: RangeFitInput): RangeFitResult {
  const log = input.log ?? (() => {});
  const maxIterations = input.maxIterations ?? 5;
  const { label, step } = input;
  // Levels are rounded to 0.01 dB, so a residual of exactly the tolerance can come out a hair above it.
  const withinTolerance = (db: number) => Math.abs(db) <= input.toleranceDb + 1e-9;
  // A delta stays a multiple of the step, so it is held at the nearest multiple inside the limits.
  const stepLimit = ({ min, max }: AttenuationLimit): AttenuationLimit => ({
    min: Math.ceil(min / step) * step || 0,
    max: Math.floor(max / step) * step || 0,
  });
  const reference = index(input.reference);
  const m0 = index(input.measure([]));
  const fits: RangeFit[] = [];
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
      // A point whose target is below the silent level would leave the measured range once fitted.
      const valid = points.filter(
        (p) => isLevel(ref[p]) && isLevel(now[p]) && isLevel((ref[p] as number) - input.shiftDb),
      );
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
        limit: stepLimit(input.limit(voice, note)),
      });
    }
    if (keys.length === 0) unmeasured.push(label(voice));
    else fits.push({ voice, keys });
  }

  const errors = (m: Map<string, Levels>, u: Unit): number[] => {
    const levels = m.get(voiceKey(u.voice)) ?? {};
    return u.points.map((p) => {
      const value = levels[p];
      if (value === null || value === undefined || !Number.isFinite(value)) {
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
    fits.flatMap((f) =>
      input.offsets(f.keys, label(f.voice)).flatMap((delta, note) => {
        const l = input.limit(f.voice, note);
        return delta < l.min || delta > l.max
          ? [
              `${label(f.voice)} note ${note}: interpolated ${delta} cB, allowed ${l.min} to ${l.max}`,
            ]
          : [];
      }),
    );
  let m = m0;
  let largest: number;
  // Notes already held at a limit they would have to pass are reported, not counted against the
  // tolerance.
  let largestFree: number;
  for (let iteration = 0; ; iteration++) {
    const residuals = units.map((u) => mean(errors(m, u)));
    const wanted = units.map(
      (u, i) =>
        u.key.attenuationDelta - Math.round((residuals[i] * ATTENUATION_PER_DB) / step) * step,
    );
    const allowed = units.map((u, i) => Math.min(u.limit.max, Math.max(u.limit.min, wanted[i])));
    const held = new Set<Unit>();
    units.forEach((u, i) => {
      if (!withinTolerance(residuals[i]) && (wanted[i] < u.limit.min || wanted[i] > u.limit.max)) {
        outOfRange.set(
          u,
          `${label(u.voice)} note ${u.note}: needs ${wanted[i]} cB, allowed ${u.limit.min} to ${u.limit.max}`,
        );
        if (u.key.attenuationDelta === allowed[i]) held.add(u);
      } else {
        outOfRange.delete(u);
      }
    });
    largest = Math.max(0, ...residuals.map(Math.abs));
    largestFree = Math.max(0, ...residuals.filter((_, i) => !held.has(units[i])).map(Math.abs));
    log(`iteration ${iteration}: largest residual ${largest.toFixed(2)} dB`);
    if (withinTolerance(largestFree) || iteration === maxIterations) break;
    units.forEach((u, i) => {
      u.key.attenuationDelta = allowed[i];
    });
    between.push(...interpolatedOutOfRange());
    if (between.length > 0) break;
    m = index(input.measure(fits));
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
    fits,
    points: errorStats(unitErrors.flatMap((x) => x.errors)),
    largestResidualDb: largest,
    unmeasured,
    unmeasuredNotes,
    outOfRange: [...outOfRange.values(), ...between],
    passed: between.length === 0 && withinTolerance(largestFree),
    worst,
  };
}

export function logRangeFit(
  result: Omit<RangeFitResult, 'fits'>,
  log: (message: string) => void,
): void {
  const s = result.points;
  log(
    `points: n=${s.count} median ${s.median.toFixed(2)} p90 ${s.p90.toFixed(2)} max ${s.max.toFixed(2)} dB`,
  );
  log(`largest residual ${result.largestResidualDb.toFixed(2)} dB`);
  log(
    `unmeasured: ${result.unmeasured.join(', ') || '-'}, unmeasured notes ${result.unmeasuredNotes}`,
  );
  for (const line of result.outOfRange) log(`out of range: ${line}`);
  for (const w of result.worst) log(`  ${w.unit}: ${w.errorDb.toFixed(2)} dB`);
}
