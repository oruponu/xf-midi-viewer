export const BIN_SECONDS = 0.005;

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

// IEC 61672 A-weighting: bilinear transform with prewarped poles, 0 dB at 1 kHz.
function aWeightingCoefficients(sampleRate: number): BiquadCoefficients[] {
  const k = 2 * sampleRate;
  const warp = (hz: number) => k * Math.tan((Math.PI * hz) / sampleRate);
  const [w1, w2, w3, w4] = [20.598997, 107.65265, 737.86223, 12194.217].map(warp);
  const section = (
    [b2, b1, b0]: readonly [number, number, number],
    [a2, a1, a0]: readonly [number, number, number],
  ): BiquadCoefficients => {
    const norm = a2 * k * k + a1 * k + a0;
    return {
      b0: (b2 * k * k + b1 * k + b0) / norm,
      b1: (2 * b0 - 2 * b2 * k * k) / norm,
      b2: (b2 * k * k - b1 * k + b0) / norm,
      a1: (2 * a0 - 2 * a2 * k * k) / norm,
      a2: (a2 * k * k - a1 * k + a0) / norm,
    };
  };
  const sections = [
    section([1, 0, 0], [1, 2 * w1, w1 * w1]),
    section([1, 0, 0], [1, w2 + w3, w2 * w3]),
    section([0, 0, 1], [1, 2 * w4, w4 * w4]),
  ];
  const w = (2 * Math.PI * 1000) / sampleRate;
  const magnitude = (x0: number, x1: number, x2: number) =>
    Math.hypot(
      x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w),
      x1 * Math.sin(w) + x2 * Math.sin(2 * w),
    );
  const gain = sections.reduce(
    (g, c) => (g * magnitude(c.b0, c.b1, c.b2)) / magnitude(1, c.a1, c.a2),
    1,
  );
  const [first, ...rest] = sections;
  return [{ ...first, b0: first.b0 / gain, b1: first.b1 / gain, b2: first.b2 / gain }, ...rest];
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

export class WeightedEnergy {
  readonly sampleRate: number;
  readonly binSeconds: number;
  private readonly binSize: number;
  private readonly left: readonly Biquad[];
  private readonly right: readonly Biquad[];
  private readonly bins: number[] = [];
  private sum = 0;
  private count = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.binSize = Math.round(sampleRate * BIN_SECONDS);
    this.binSeconds = this.binSize / sampleRate;
    const coefficients = aWeightingCoefficients(sampleRate);
    this.left = coefficients.map((c) => new Biquad(c));
    this.right = coefficients.map((c) => new Biquad(c));
  }

  push(left: Float32Array, right: Float32Array): void {
    for (let i = 0; i < left.length; i++) {
      let l = left[i];
      let r = right[i];
      for (const f of this.left) l = f.process(l);
      for (const f of this.right) r = f.process(r);
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
