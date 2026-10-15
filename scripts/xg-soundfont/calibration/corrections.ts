import { readFileSync, writeFileSync } from 'node:fs';

export interface DrumLayer {
  velocity: readonly [number, number];
  sample: string;
  attenuation: number;
  velocityAmount: number;
}

export interface DrumKey {
  kit: number;
  key: number;
  layers: DrumLayer[];
}

export interface VoiceZone {
  instrument: string;
  attenuation: number;
  velocityAmountDelta: number;
}

export interface Voice {
  bankMSB: number;
  program: number;
  zones: VoiceZone[];
}

export type ExcludedUnit = { kit: number; key: number } | { bankMSB: number; program: number };

export interface CalibrationUnits {
  drums: DrumKey[];
  voices: Voice[];
}

export interface VariationCorrection {
  program: number;
  bankLSB: number;
  attenuationDelta: number;
  velocityAmountDelta: number;
}

export interface RangeKey {
  key: number;
  attenuationDelta: number;
}

export interface RangeCorrection {
  bankMSB: number;
  program: number;
  keys: RangeKey[];
}

export interface VariationRangeCorrection {
  program: number;
  bankLSB: number;
  keys: RangeKey[];
}

export interface Corrections extends CalibrationUnits {
  outputGainDb: number;
  commonAttenuation: number;
  sourceSha256: string | null;
  excluded: ExcludedUnit[];
  variations: VariationCorrection[];
  ranges: RangeCorrection[];
  variationRanges: VariationRangeCorrection[];
}

export const NO_CORRECTIONS: Corrections = {
  outputGainDb: 0,
  commonAttenuation: 0,
  sourceSha256: null,
  excluded: [],
  drums: [],
  voices: [],
  variations: [],
  ranges: [],
  variationRanges: [],
};

export function readCorrections(path: string): Corrections {
  const corrections = JSON.parse(readFileSync(path, 'utf8')) as Corrections;
  // Files written before the range or variation range corrections lack those fields.
  return {
    ...corrections,
    ranges: corrections.ranges ?? [],
    variationRanges: corrections.variationRanges ?? [],
  };
}

export function writeCorrections(path: string, corrections: Corrections): void {
  writeFileSync(path, `${JSON.stringify(corrections, null, 2)}\n`);
}

export function isExcludedDrum(
  excluded: readonly ExcludedUnit[],
  kit: number,
  key: number,
): boolean {
  return excluded.some((e) => 'kit' in e && e.kit === kit && e.key === key);
}

export function isExcludedVoice(
  excluded: readonly ExcludedUnit[],
  bankMSB: number,
  program: number,
): boolean {
  return excluded.some((e) => 'bankMSB' in e && e.bankMSB === bankMSB && e.program === program);
}
