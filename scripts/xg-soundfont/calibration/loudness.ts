export const BIN_SECONDS = 0.005;

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

// Formula and constants from libebur128; they reproduce the BS.1770 coefficients at 48 kHz.
export function kWeightingCoefficients(
  sampleRate: number,
): readonly [BiquadCoefficients, BiquadCoefficients] {
  let f0 = 1681.974450955533;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highPass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highPass];
}

class Biquad {
  private readonly c: BiquadCoefficients;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(coefficients: BiquadCoefficients) {
    this.c = coefficients;
  }

  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class KWeightedEnergy {
  readonly sampleRate: number;
  readonly binSeconds: number;
  private readonly binSize: number;
  private readonly left: readonly [Biquad, Biquad];
  private readonly right: readonly [Biquad, Biquad];
  private readonly bins: number[] = [];
  private sum = 0;
  private count = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.binSize = Math.round(sampleRate * BIN_SECONDS);
    this.binSeconds = this.binSize / sampleRate;
    const [shelf, highPass] = kWeightingCoefficients(sampleRate);
    this.left = [new Biquad(shelf), new Biquad(highPass)];
    this.right = [new Biquad(shelf), new Biquad(highPass)];
  }

  push(left: Float32Array, right: Float32Array): void {
    for (let i = 0; i < left.length; i++) {
      const l = this.left[1].process(this.left[0].process(left[i]));
      const r = this.right[1].process(this.right[0].process(right[i]));
      this.sum += l * l + r * r;
      if (++this.count === this.binSize) {
        this.bins.push(this.sum / (2 * this.binSize));
        this.sum = 0;
        this.count = 0;
      }
    }
  }

  levelDb(startSeconds: number, durationSeconds: number): number {
    const [from, to] = this.binRange(startSeconds, startSeconds + durationSeconds);
    return toDb(mean(this.bins, from, to));
  }

  peakWindowDb(startSeconds: number, endSeconds: number, windowSeconds: number): number {
    const [from, to] = this.binRange(startSeconds, endSeconds);
    const width = Math.max(1, Math.round(windowSeconds / this.binSeconds));
    let best = 0;
    for (let i = from; i + width <= to; i++) best = Math.max(best, mean(this.bins, i, i + width));
    return toDb(best);
  }

  onsetSeconds(startSeconds: number, endSeconds: number, relativeDb: number): number | null {
    const [from, to] = this.binRange(startSeconds, endSeconds);
    let max = 0;
    for (let i = from; i < to; i++) max = Math.max(max, this.bins[i]);
    if (max === 0) return null;
    const threshold = max * 10 ** (relativeDb / 10);
    for (let i = from; i < to; i++) if (this.bins[i] >= threshold) return i * this.binSeconds;
    return null;
  }

  private binRange(startSeconds: number, endSeconds: number): [number, number] {
    const from = Math.max(0, Math.floor(startSeconds / this.binSeconds));
    const to = Math.min(this.bins.length, Math.ceil(endSeconds / this.binSeconds));
    return [from, Math.max(from, to)];
  }
}

function mean(values: readonly number[], from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  return sum / (to - from);
}

function toDb(meanSquare: number): number {
  return meanSquare > 0 ? 10 * Math.log10(meanSquare) : -Infinity;
}
