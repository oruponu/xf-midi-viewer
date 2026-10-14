import type { RangeKey } from './corrections.ts';

export interface RangeBand {
  readonly min: number;
  readonly max: number;
  readonly delta: number;
}

// Deltas for keys 0-127: straight lines between the given keys, the end values outside them.
export function rangeOffsets(keys: readonly RangeKey[], where: string): number[] {
  if (keys.length === 0) throw new Error(`${where}: the range correction has no keys`);
  const sorted = [...keys].sort((a, b) => a.key - b.key);
  sorted.forEach(({ key }, i) => {
    if (!Number.isInteger(key) || key < 0 || key > 127) {
      throw new Error(`${where}: key ${key} is out of range`);
    }
    if (i > 0 && sorted[i - 1].key === key) throw new Error(`${where}: key ${key} appears twice`);
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return Array.from({ length: 128 }, (_, note) => {
    if (note <= first.key) return first.attenuationDelta;
    if (note >= last.key) return last.attenuationDelta;
    const i = sorted.findIndex((k) => k.key >= note);
    const a = sorted[i - 1];
    const b = sorted[i];
    return Math.round(
      a.attenuationDelta +
        ((b.attenuationDelta - a.attenuationDelta) * (note - a.key)) / (b.key - a.key),
    );
  });
}

export const VARIATION_RANGE_STEP = 10;

// Rounded so that neighbouring notes share a delta and need fewer zones.
export function steppedRangeOffsets(
  keys: readonly RangeKey[],
  where: string,
  step: number,
): number[] {
  return rangeOffsets(keys, where).map((delta) => Math.round(delta / step) * step || 0);
}

export function rangeBands(offsets: readonly number[], min: number, max: number): RangeBand[] {
  const bands: RangeBand[] = [];
  for (let note = min; note <= max; note++) {
    const previous = bands.at(-1);
    if (previous && previous.delta === offsets[note]) {
      bands[bands.length - 1] = { ...previous, max: note };
    } else {
      bands.push({ min: note, max: note, delta: offsets[note] });
    }
  }
  return bands;
}
