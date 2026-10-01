import { describe, expect, test } from 'bun:test';
import { KWeightedEnergy } from './loudness.ts';
import { SILENT_DB, drumLevels, markerShift, voiceLevels } from './levels.ts';
import { drumTestMidi, voiceTestMidi } from './testMidi.ts';
import type { TestMidi } from './testMidi.ts';

const RATE = 44100;

function toneBursts<P>(
  midi: TestMidi<P>,
  delay: number,
  burstSeconds: number,
  amplitude: (probe: P) => number,
): KWeightedEnergy {
  const total = Math.ceil((midi.endSeconds + 1) * RATE);
  const signal = new Float32Array(total);
  const burst = (at: number, amp: number) => {
    const from = Math.round((at + delay) * RATE);
    for (let i = 0; i < Math.round(burstSeconds * RATE); i++) {
      signal[from + i] += amp * Math.sin((2 * Math.PI * 997 * i) / RATE);
    }
  };
  burst(midi.markerSeconds, 0.8);
  for (const { probe, seconds: at } of midi.probes) burst(at, amplitude(probe));
  const energy = new KWeightedEnergy(RATE);
  energy.push(signal, signal);
  return energy;
}

describe('markerShift', () => {
  test('measures how late or early the marker hit sounds', () => {
    const midi = drumTestMidi([0], [36], [64]);
    expect(
      markerShift(
        toneBursts(midi, 0.4, 0.05, () => 0.1),
        midi,
      ),
    ).toBeCloseTo(0.4, 1);
    expect(
      markerShift(
        toneBursts(midi, -0.3, 0.05, () => 0.1),
        midi,
      ),
    ).toBeCloseTo(-0.3, 1);
  });

  test('throws when the marker is missing', () => {
    const midi = drumTestMidi([0], [36], [64]);
    const energy = new KWeightedEnergy(RATE);
    const silence = new Float32Array(RATE * 5);
    energy.push(silence, silence);
    expect(() => markerShift(energy, midi)).toThrow('Marker hit not found');
  });
});

describe('drumLevels', () => {
  test('measures each hit after the marker shift and silent keys below the threshold', () => {
    const midi = drumTestMidi([0], [36, 37], [64, 127]);
    const energy = toneBursts(midi, -0.3, 0.05, (p) =>
      p.key === 37 ? 0 : p.velocity === 127 ? 0.4 : 0.2,
    );
    const [k36, k37] = drumLevels(energy, midi);
    expect([k36.kit, k36.key]).toEqual([0, 36]);
    expect(k36.levels['127']! - k36.levels['64']!).toBeCloseTo(6.02, 0);
    expect(Object.values(k37.levels).every((l) => l === null || l < SILENT_DB)).toBe(true);
  });
});

describe('voiceLevels', () => {
  test('averages one second of each note', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [64, 127]);
    const energy = toneBursts(midi, 0, 1, (p) => (p.velocity === 127 ? 0.4 : 0.1));
    const [voice] = voiceLevels(energy, midi);
    expect([voice.bankMSB, voice.program]).toEqual([0, 0]);
    expect(voice.levels['60/127']! - voice.levels['60/64']!).toBeCloseTo(12.04, 0);
  });
});
