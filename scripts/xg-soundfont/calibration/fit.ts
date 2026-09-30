import { SILENT_DB } from './levels.ts';
import type { Level } from './levels.ts';

export const ATTENUATION_PER_DB = 25;
export const DRUM_FIT_MIN_VELOCITY = 24;
export const DRUM_SLOPE_MIN_VELOCITY = 32;
export const VOICE_SLOPE_MIN_VELOCITY = 40;
// The default concave velocity curve with 960 cB gives about 12 dB per doubling.
export const DB_PER_DOUBLING_PER_AMOUNT = (40 * Math.log10(2)) / 960;
const MIN_SLOPE_VELOCITIES = 3;
const MIN_MEASURED_SLOPE_DB = 1;
const MIN_RATIO = 0.3;
const MAX_RATIO = 1.3;
const MAX_MEDIAN_ERROR_DB = 0.5;
const MAX_P90_ERROR_DB = 2;

export interface Point {
  readonly velocity: number;
  readonly reference: number;
  readonly measured: number;
}

export const drumVelocity = (key: string): number => Number(key);
export const voiceVelocity = (key: string): number => Number(key.split('/')[1]);

export function pairPoints(
  reference: Readonly<Record<string, Level>>,
  measured: Readonly<Record<string, Level>>,
  velocityOf: (key: string) => number,
): Point[] {
  const points: Point[] = [];
  for (const [key, ref] of Object.entries(reference)) {
    const value = measured[key];
    if (ref === null || value === null || value === undefined) continue;
    if (!Number.isFinite(ref) || !Number.isFinite(value)) continue;
    if (ref < SILENT_DB || value < SILENT_DB) continue;
    points.push({ velocity: velocityOf(key), reference: ref, measured: value });
  }
  return points;
}

export function pointsAt(
  reference: Readonly<Record<string, Level>>,
  measured: Readonly<Record<string, Level>>,
  keys: readonly string[],
  velocityOf: (key: string) => number,
  unit: string,
): Point[] {
  return keys.map((key) => {
    const ref = reference[key];
    const value = measured[key];
    if (
      ref === null ||
      ref === undefined ||
      value === null ||
      value === undefined ||
      !Number.isFinite(ref) ||
      !Number.isFinite(value)
    ) {
      throw new Error(`${unit} point ${key} can no longer be measured`);
    }
    return { velocity: velocityOf(key), reference: ref, measured: value };
  });
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function slopePerDoubling(
  points: readonly { velocity: number; level: number }[],
): number | null {
  if (new Set(points.map((p) => p.velocity)).size < MIN_SLOPE_VELOCITIES) return null;
  const xs = points.map((p) => Math.log2(p.velocity));
  const ys = points.map((p) => p.level);
  const mx = average(xs);
  const my = average(ys);
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, i) => {
    numerator += (x - mx) * (ys[i] - my);
    denominator += (x - mx) ** 2;
  });
  const slope = numerator / denominator;
  return Number.isFinite(slope) ? slope : null;
}

function slopes(
  points: readonly Point[],
  minVelocity: number,
): { reference: number; measured: number } | null {
  const used = points.filter((p) => p.velocity >= minVelocity);
  const reference = slopePerDoubling(
    used.map((p) => ({ velocity: p.velocity, level: p.reference })),
  );
  const measured = slopePerDoubling(used.map((p) => ({ velocity: p.velocity, level: p.measured })));
  if (reference === null || measured === null || Math.abs(measured) < MIN_MEASURED_SLOPE_DB) {
    return null;
  }
  return { reference, measured };
}

export function drumVelocityRatio(points: readonly Point[]): number | null {
  const s = slopes(points, DRUM_SLOPE_MIN_VELOCITY);
  if (!s) return null;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, s.reference / s.measured));
}

export function voiceVelocityDelta(points: readonly Point[]): number | null {
  const s = slopes(points, VOICE_SLOPE_MIN_VELOCITY);
  if (!s) return null;
  return Math.round((s.reference - s.measured) / DB_PER_DOUBLING_PER_AMOUNT);
}

export function meanDifference(points: readonly Point[]): number | null {
  return points.length ? average(points.map((p) => p.reference - p.measured)) : null;
}

export function residualDb(points: readonly Point[], shiftDb: number): number | null {
  return points.length ? average(points.map((p) => p.reference - shiftDb - p.measured)) : null;
}

export function commonShiftDb(differences: readonly (number | null)[]): number {
  const values = differences.filter((d): d is number => d !== null);
  if (values.length === 0) throw new Error('No unit has a difference from the reference');
  return Math.max(...values);
}

export interface ErrorStats {
  readonly count: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

export function errorStats(errors: readonly number[]): ErrorStats {
  if (errors.length === 0) return { count: 0, median: 0, p90: 0, max: 0 };
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, median: rank(0.5), p90: rank(0.9), max: sorted.at(-1)! };
}

export function meetsCriteria(stats: ErrorStats): boolean {
  return stats.median <= MAX_MEDIAN_ERROR_DB && stats.p90 <= MAX_P90_ERROR_DB;
}
