// Usage: bun scripts/xg-soundfont/calibration/calibrate.ts <reference levels json>
// Rewrites corrections.json only when the fit meets the error criteria.
import { readFileSync } from 'node:fs';
import { SpessaLog } from 'spessasynth_core';
import { buildXgBank, readSoundBank, sourceSha256 } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { listUnits } from './apply.ts';
import {
  NO_CORRECTIONS,
  isExcludedDrum,
  isExcludedVoice,
  readCorrections,
  writeCorrections,
} from './corrections.ts';
import type { CalibrationUnits, Corrections, DrumKey, ExcludedUnit, Voice } from './corrections.ts';
import {
  ATTENUATION_PER_DB,
  DRUM_FIT_MIN_VELOCITY,
  commonShiftDb,
  drumVelocity,
  drumVelocityRatio,
  errorStats,
  meanDifference,
  meetsCriteria,
  pairPoints,
  pointsAt,
  residualDb,
  voiceVelocity,
  voiceVelocityDelta,
} from './fit.ts';
import type { ErrorStats, Point } from './fit.ts';
import type { Level, LevelTable } from './levels.ts';
import { measureBank, sf3DecoderReady } from './render.ts';

export interface CalibrationInput {
  readonly units: CalibrationUnits;
  readonly reference: LevelTable;
  readonly excluded: readonly ExcludedUnit[];
  readonly measure: (corrections: Corrections) => LevelTable;
  readonly maxIterations?: number;
  readonly maxRetries?: number;
  readonly log?: (message: string) => void;
}

export interface CalibrationResult {
  readonly corrections: Corrections;
  readonly drums: ErrorStats;
  readonly voices: ErrorStats;
  readonly voiceMeans: ErrorStats;
  readonly passed: boolean;
  readonly unmeasured: readonly string[];
  readonly worst: readonly { unit: string; errorDb: number }[];
}

const TOLERANCE_DB = 0.1;
const WORST_COUNT = 20;

type Index = Map<string, Readonly<Record<string, Level>>>;
const drumId = (kit: number, key: number) => `drum ${kit}/${key}`;
const voiceId = (bankMSB: number, program: number) => `voice ${bankMSB}/${program}`;

function index(table: LevelTable): Index {
  const map: Index = new Map();
  for (const d of table.drums) map.set(drumId(d.kit, d.key), d.levels);
  for (const v of table.voices) map.set(voiceId(v.bankMSB, v.program), v.levels);
  return map;
}

interface Unit {
  readonly id: string;
  readonly drum: boolean;
  readonly keys: readonly string[];
  readonly points: (measured: Index) => Point[];
  readonly targets: { attenuation: number }[];
  readonly start: number[];
  readonly restoreVelocity: () => void;
}

export function calibrate(input: CalibrationInput): CalibrationResult {
  const log = input.log ?? (() => {});
  const maxIterations = input.maxIterations ?? 5;
  const maxRetries = input.maxRetries ?? 3;
  const reference = index(input.reference);
  for (const e of input.excluded) {
    const found =
      'kit' in e
        ? input.units.drums.some((d) => d.kit === e.kit && d.key === e.key)
        : input.units.voices.some((v) => v.bankMSB === e.bankMSB && v.program === e.program);
    if (!found) throw new Error(`Excluded entry ${JSON.stringify(e)} matches no unit`);
  }
  const drums: DrumKey[] = input.units.drums
    .filter((d) => !isExcludedDrum(input.excluded, d.kit, d.key))
    .map((d) => ({ ...d, layers: d.layers.map((l) => ({ ...l })) }));
  const voices: Voice[] = input.units.voices
    .filter((v) => !isExcludedVoice(input.excluded, v.bankMSB, v.program))
    .map((v) => ({ ...v, zones: v.zones.map((z) => ({ ...z })) }));
  let common = 0;
  const current = (): Corrections => ({
    ...NO_CORRECTIONS,
    excluded: [...input.excluded],
    commonAttenuation: common,
    drums,
    voices,
  });
  const drumPoints = (m: Index, d: DrumKey) =>
    pairPoints(
      reference.get(drumId(d.kit, d.key)) ?? {},
      m.get(drumId(d.kit, d.key)) ?? {},
      drumVelocity,
    ).filter((p) => p.velocity >= DRUM_FIT_MIN_VELOCITY);
  const voicePoints = (m: Index, v: Voice) =>
    pairPoints(
      reference.get(voiceId(v.bankMSB, v.program)) ?? {},
      m.get(voiceId(v.bankMSB, v.program)) ?? {},
      voiceVelocity,
    );
  const validKeys = (
    id: string,
    m: Index,
    velocityOf: (key: string) => number,
    accept: (velocity: number) => boolean,
  ) => {
    const ref = reference.get(id) ?? {};
    const now = m.get(id) ?? {};
    return Object.keys(ref).filter(
      (key) =>
        accept(velocityOf(key)) &&
        pairPoints({ [key]: ref[key] }, { [key]: now[key] }, velocityOf).length === 1,
    );
  };
  const originalAmount = new Map(
    drums.flatMap((d) => d.layers.map((l) => [l, l.velocityAmount] as const)),
  );
  const originalDelta = new Map(
    voices.flatMap((v) => v.zones.map((z) => [z, z.velocityAmountDelta] as const)),
  );

  // Velocity sensitivity first, since it also moves the average level.
  const m0 = index(input.measure(current()));
  for (const d of drums) {
    const ratio = drumVelocityRatio(drumPoints(m0, d));
    if (ratio !== null)
      for (const l of d.layers) l.velocityAmount = Math.round(l.velocityAmount * ratio);
  }
  for (const v of voices) {
    const delta = voiceVelocityDelta(voicePoints(m0, v));
    if (delta !== null) for (const z of v.zones) z.velocityAmountDelta += delta;
  }
  const g0 = index(input.measure(current()));

  // The points of each unit are fixed here, so lowering a unit below -80 dB later does not drop them.
  const units: Unit[] = [
    ...drums.flatMap((d) =>
      d.layers.map((l): Unit => {
        const levelsId = drumId(d.kit, d.key);
        const id = `${levelsId} ${l.velocity[0]}-${l.velocity[1]}`;
        const keys = validKeys(
          levelsId,
          g0,
          drumVelocity,
          (v) => v >= DRUM_FIT_MIN_VELOCITY && v >= l.velocity[0] && v <= l.velocity[1],
        );
        return {
          id,
          drum: true,
          keys,
          points: (m) =>
            pointsAt(reference.get(levelsId) ?? {}, m.get(levelsId) ?? {}, keys, drumVelocity, id),
          targets: [l],
          start: [l.attenuation],
          restoreVelocity: () => {
            l.velocityAmount = originalAmount.get(l)!;
          },
        };
      }),
    ),
    ...voices.map((v): Unit => {
      const id = voiceId(v.bankMSB, v.program);
      const keys = validKeys(id, g0, voiceVelocity, () => true);
      return {
        id,
        drum: false,
        keys,
        points: (m) => pointsAt(reference.get(id) ?? {}, m.get(id) ?? {}, keys, voiceVelocity, id),
        targets: v.zones,
        start: v.zones.map((z) => z.attenuation),
        restoreVelocity: () => {
          for (const z of v.zones) z.velocityAmountDelta = originalDelta.get(z)!;
        },
      };
    }),
  ];
  const measured = units.filter((u) => u.keys.length > 0);
  const unmeasured = units.filter((u) => u.keys.length === 0);
  for (const u of unmeasured) u.restoreVelocity();
  const difference0 = new Map(measured.map((u) => [u, meanDifference(u.points(g0))!]));
  const c0 = commonShiftDb([...difference0.values()]);
  if (c0 < 0) {
    throw new Error(
      'Reference is quieter than the sound bank for every unit; the common shift would be negative',
    );
  }

  let margin = 0;
  let shift = c0;
  let deficit = 0;
  const offsets = new Map<Unit, number>();
  const applyOffsets = () => {
    for (const u of units) {
      u.targets.forEach((t, i) => {
        t.attenuation = Math.max(0, u.start[i] + offsets.get(u)!);
      });
    }
  };
  for (let retry = 0; retry <= maxRetries; retry++) {
    shift = c0 + margin;
    common = Math.round(shift * ATTENUATION_PER_DB);
    for (const u of measured)
      offsets.set(u, Math.round((shift - difference0.get(u)!) * ATTENUATION_PER_DB));
    for (const u of unmeasured) offsets.set(u, common);
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      applyOffsets();
      const m = index(input.measure(current()));
      let largest = 0;
      deficit = 0;
      for (const u of measured) {
        const r = residualDb(u.points(m), shift) ?? 0;
        let newOffset = offsets.get(u)! - Math.round(r * ATTENUATION_PER_DB);
        const floorOffset = -Math.min(...u.start);
        if (newOffset < floorOffset) {
          deficit = Math.max(deficit, (floorOffset - newOffset) / ATTENUATION_PER_DB);
          newOffset = floorOffset;
        }
        offsets.set(u, newOffset);
        largest = Math.max(largest, Math.abs(r));
      }
      log(
        `shift ${shift.toFixed(2)} dB, iteration ${iteration + 1}: largest residual ${largest.toFixed(2)} dB`,
      );
      if (largest < TOLERANCE_DB) break;
    }
    applyOffsets();
    if (deficit === 0) break;
    if (retry < maxRetries) {
      log(`attenuation floor reached (${deficit.toFixed(2)} dB short), raising the common shift`);
      margin += deficit;
    } else {
      log(`attenuation floor reached (${deficit.toFixed(2)} dB short); retries exhausted`);
    }
  }

  const final = index(input.measure(current()));
  const unitErrors = measured.map((u) => ({
    unit: u.id,
    drum: u.drum,
    errors: u.points(final).map((p) => p.reference - shift - p.measured),
  }));
  const drumStats = errorStats(unitErrors.filter((u) => u.drum).flatMap((u) => u.errors));
  const voiceStats = errorStats(unitErrors.filter((u) => !u.drum).flatMap((u) => u.errors));
  // One level per voice cannot remove the spread across its notes.
  const voiceMeanStats = errorStats(
    unitErrors
      .filter((u) => !u.drum)
      .map((u) => u.errors.reduce((s, e) => s + e, 0) / u.errors.length),
  );
  const worst = unitErrors
    .map((u) => ({
      unit: u.unit,
      errorDb: u.errors.reduce((s, e) => s + Math.abs(e), 0) / u.errors.length,
    }))
    .sort((a, b) => b.errorDb - a.errorDb)
    .slice(0, WORST_COUNT);
  return {
    corrections: current(),
    drums: drumStats,
    voices: voiceStats,
    voiceMeans: voiceMeanStats,
    passed: deficit === 0 && meetsCriteria(drumStats) && meetsCriteria(voiceMeanStats),
    unmeasured: unmeasured.map((u) => u.id),
    worst,
  };
}

if (import.meta.main) {
  const [referencePath] = process.argv.slice(2);
  if (!referencePath) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/calibrate.ts <reference levels json>',
    );
    process.exit(2);
  }
  SpessaLog.setLogLevel(false, false, false);
  await sf3DecoderReady();
  const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
  const existing = readCorrections(CORRECTIONS_PATH);
  let count = 0;
  const result = calibrate({
    units: listUnits(buildXgBank(source, NO_CORRECTIONS)),
    reference: JSON.parse(readFileSync(referencePath, 'utf8')) as LevelTable,
    excluded: existing.excluded,
    measure: (corrections) => {
      console.log(`measure ${++count}`);
      return measureBank(buildXgBank(source, corrections));
    },
    log: console.log,
  });
  const show = (name: string, s: ErrorStats) =>
    console.log(
      `${name}: n=${s.count} median ${s.median.toFixed(2)} p90 ${s.p90.toFixed(2)} max ${s.max.toFixed(2)} dB`,
    );
  show('drums', result.drums);
  show('voices', result.voices);
  show('voice means', result.voiceMeans);
  console.log(`common attenuation ${result.corrections.commonAttenuation}`);
  console.log(`unmeasured: ${result.unmeasured.join(', ') || '-'}`);
  for (const w of result.worst) console.log(`  ${w.unit}: ${w.errorDb.toFixed(2)} dB`);
  if (!result.passed) {
    console.error('The fit does not meet the error criteria; corrections.json was not written');
    process.exit(1);
  }
  writeCorrections(CORRECTIONS_PATH, {
    ...result.corrections,
    outputGainDb: existing.outputGainDb,
    sourceSha256: sourceSha256(source),
  });
  console.log('outputGainDb was kept from the previous file; run outputGain.ts again');
}
