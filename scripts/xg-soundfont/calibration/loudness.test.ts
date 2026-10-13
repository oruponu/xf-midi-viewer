import { describe, expect, test } from 'bun:test';
import { WeightedEnergy } from './loudness.ts';

function tone(frequency: number, sampleRate: number, seconds: number, amplitude = 1): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// IEC 61672-1 A-weighting at the one-third-octave centre frequencies.
const A_WEIGHTING: readonly (readonly [number, number])[] = [
  [20, -50.5],
  [25, -44.7],
  [31.5, -39.4],
  [40, -34.6],
  [50, -30.2],
  [63, -26.2],
  [80, -22.5],
  [100, -19.1],
  [125, -16.1],
  [160, -13.4],
  [200, -10.9],
  [250, -8.6],
  [315, -6.6],
  [400, -4.8],
  [500, -3.2],
  [630, -1.9],
  [800, -0.8],
  [1000, 0],
  [1250, 0.6],
  [1600, 1.0],
  [2000, 1.2],
  [2500, 1.3],
  [3150, 1.2],
  [4000, 1.0],
  [5000, 0.5],
  [6300, -0.1],
  [8000, -1.1],
  [10000, -2.5],
  [12500, -4.3],
  [16000, -6.6],
];

function gainDb(frequency: number, sampleRate: number): number {
  const energy = new WeightedEnergy(sampleRate);
  const signal = tone(frequency, sampleRate, 3);
  energy.push(signal, signal);
  return energy.levelDb(1.5, 1.5) - 10 * Math.log10(0.5);
}

describe('WeightedEnergy', () => {
  test('passes 1 kHz at 0 dB', () => {
    expect(gainDb(1000, 44100)).toBeCloseTo(0, 2);
  });

  test.each([44100, 48000])(
    'follows the A-weighting table within 1 dB up to 12.5 kHz at %i Hz',
    (sampleRate) => {
      for (const [frequency, expected] of A_WEIGHTING.filter(([f]) => f <= 12500)) {
        expect(Math.abs(gainDb(frequency, sampleRate) - expected)).toBeLessThan(1);
      }
    },
  );

  test.each([44100, 48000])(
    'stays within the class 1 tolerance at 16 kHz at %i Hz',
    (sampleRate) => {
      const gain = gainDb(16000, sampleRate);
      expect(gain).toBeGreaterThan(-6.6 - 17);
      expect(gain).toBeLessThan(-6.6 + 3.5);
    },
  );

  test('does not depend on how the input is split into blocks', () => {
    let seed = 1;
    const noise = new Float32Array(44100);
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise[i] = seed / 1073741824 - 1;
    }
    const whole = new WeightedEnergy(44100);
    whole.push(noise, noise);
    const blocks = new WeightedEnergy(44100);
    for (let i = 0; i < noise.length; i += 100) {
      blocks.push(noise.subarray(i, i + 100), noise.subarray(i, i + 100));
    }
    expect(blocks.levelDb(0, 1)).toBe(whole.levelDb(0, 1));
  });

  test('finds the loudest window and the onset of a short tone', () => {
    const sampleRate = 44100;
    const burst = concat(
      new Float32Array(sampleRate),
      tone(997, sampleRate, 0.1, 0.5),
      new Float32Array(sampleRate),
    );
    const energy = new WeightedEnergy(sampleRate);
    energy.push(burst, burst);
    const steady = new WeightedEnergy(sampleRate);
    const long = tone(997, sampleRate, 2, 0.5);
    steady.push(long, long);

    expect(energy.peakWindowDb(0.98, 1.3, 0.05)).toBeCloseTo(steady.levelDb(1, 1), 0);
    expect(energy.levelDb(0.98, 0.32)).toBeLessThan(energy.peakWindowDb(0.98, 1.3, 0.05));
    expect(energy.onsetSeconds(0, 2, -20)).toBeCloseTo(1, 1);
  });

  test('reports silence as -Infinity and no onset', () => {
    const energy = new WeightedEnergy(44100);
    const silence = new Float32Array(44100);
    energy.push(silence, silence);
    expect(energy.levelDb(0, 1)).toBe(-Infinity);
    expect(energy.peakWindowDb(0, 1, 0.05)).toBe(-Infinity);
    expect(energy.onsetSeconds(0, 1, -20)).toBeNull();
  });
});
