import { describe, expect, test } from 'bun:test';
import { KWeightedEnergy, kWeightingCoefficients } from './loudness.ts';

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

function gainDb(frequency: number, sampleRate: number): number {
  const energy = new KWeightedEnergy(sampleRate);
  const signal = tone(frequency, sampleRate, 2);
  energy.push(signal, signal);
  return energy.levelDb(1, 1) - 10 * Math.log10(0.5);
}

describe('kWeightingCoefficients', () => {
  test('matches the BS.1770 coefficients at 48 kHz', () => {
    const [shelf, highPass] = kWeightingCoefficients(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 8);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 8);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 8);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 8);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 8);
    expect([highPass.b0, highPass.b1, highPass.b2]).toEqual([1, -2, 1]);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 8);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 8);
  });
});

describe('KWeightedEnergy', () => {
  test.each([44100, 48000])('weights tones as BS.1770 does at %i Hz', (sampleRate) => {
    expect(gainDb(997, sampleRate)).toBeCloseTo(0.69, 1);
    expect(gainDb(20, sampleRate)).toBeCloseTo(-13.27, 1);
    expect(gainDb(5000, sampleRate)).toBeCloseTo(4.01, 1);
  });

  test('does not depend on how the input is split into blocks', () => {
    let seed = 1;
    const noise = new Float32Array(44100);
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise[i] = seed / 1073741824 - 1;
    }
    const whole = new KWeightedEnergy(44100);
    whole.push(noise, noise);
    const blocks = new KWeightedEnergy(44100);
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
    const energy = new KWeightedEnergy(sampleRate);
    energy.push(burst, burst);
    const steady = new KWeightedEnergy(sampleRate);
    const long = tone(997, sampleRate, 2, 0.5);
    steady.push(long, long);

    expect(energy.peakWindowDb(0.98, 1.3, 0.05)).toBeCloseTo(steady.levelDb(1, 1), 0);
    expect(energy.levelDb(0.98, 0.32)).toBeLessThan(energy.peakWindowDb(0.98, 1.3, 0.05));
    expect(energy.onsetSeconds(0, 2, -20)).toBeCloseTo(1, 1);
  });

  test('reports silence as -Infinity and no onset', () => {
    const energy = new KWeightedEnergy(44100);
    const silence = new Float32Array(44100);
    energy.push(silence, silence);
    expect(energy.levelDb(0, 1)).toBe(-Infinity);
    expect(energy.peakWindowDb(0, 1, 0.05)).toBe(-Infinity);
    expect(energy.onsetSeconds(0, 1, -20)).toBeNull();
  });
});
