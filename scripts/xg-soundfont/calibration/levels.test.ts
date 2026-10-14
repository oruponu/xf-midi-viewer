import { describe, expect, test } from 'bun:test';
import { WeightedEnergy } from './loudness.ts';
import { SILENT_DB, drumLevels, markerShift, voiceLevels } from './levels.ts';
import { drumTestMidi, voiceTestMidi } from './testMidi.ts';
import type { TestMidi, VoiceProbe } from './testMidi.ts';

const RATE = 44100;

function toneBursts<P>(
  midi: TestMidi<P>,
  delay: number,
  burstSeconds: number,
  amplitude: (probe: P) => number,
): WeightedEnergy {
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
  const energy = new WeightedEnergy(RATE);
  energy.push(signal, signal);
  return energy;
}

// `t` is seconds from each note-on; each tone is cut off at 1.5 s.
function shapedNotes(
  midi: TestMidi<VoiceProbe>,
  amplitude: (probe: VoiceProbe, t: number) => number,
): WeightedEnergy {
  const total = Math.ceil((midi.endSeconds + 2) * RATE);
  const signal = new Float32Array(total);
  const marker = Math.round(midi.markerSeconds * RATE);
  for (let i = 0; i < Math.round(0.05 * RATE); i++) {
    signal[marker + i] = 0.8 * Math.sin((2 * Math.PI * 997 * i) / RATE);
  }
  for (const { probe, seconds } of midi.probes) {
    const from = Math.round(seconds * RATE);
    for (let i = 0; i < Math.round(1.5 * RATE); i++) {
      signal[from + i] += amplitude(probe, i / RATE) * Math.sin((2 * Math.PI * 997 * i) / RATE);
    }
  }
  const energy = new WeightedEnergy(RATE);
  energy.push(signal, signal);
  return energy;
}

// Mean square of a sine of amplitude a is a^2 / 2; A-weighting is about 0 dB at 997 Hz.
const sineDb = (a: number) => 10 * Math.log10((a * a) / 2);

describe('markerShift', () => {
  test('finds a marker hit made of a low tone', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [100]);
    const total = Math.ceil((midi.endSeconds + 1) * RATE);
    const signal = new Float32Array(total);
    const from = Math.round((midi.markerSeconds + 0.4) * RATE);
    for (let i = 0; i < Math.round(0.2 * RATE); i++) {
      signal[from + i] = 0.8 * Math.sin((2 * Math.PI * 60 * i) / RATE);
    }
    const energy = new WeightedEnergy(RATE);
    energy.push(signal, signal);
    expect(markerShift(energy, midi)).toBeCloseTo(0.4, 1);
  });

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
    const energy = new WeightedEnergy(RATE);
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
  test('measures a steady note the same as its one-second average', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [64, 127]);
    const energy = shapedNotes(midi, (p, t) => (t < 1 ? (p.velocity === 127 ? 0.4 : 0.1) : 0));
    const [voice] = voiceLevels(energy, midi);
    expect([voice.bankMSB, voice.program]).toEqual([0, 0]);
    expect(voice.levels['60/127']!).toBeCloseTo(sineDb(0.4), 1);
    expect(voice.levels['60/127']! - voice.levels['60/64']!).toBeCloseTo(12.04, 1);
  });

  test('measures a decaying note at its attack', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [100]);
    // The one-second average of this note is about 3.9 dB lower.
    const energy = shapedNotes(midi, (_, t) => (t < 0.4 ? 0.4 : t < 1 ? 0.04 : 0));
    const [voice] = voiceLevels(energy, midi);
    expect(voice.levels['60/100']!).toBeCloseTo(sineDb(0.4), 0);
  });

  test('measures a slowly rising note at its loudest window', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [100]);
    const energy = shapedNotes(midi, (_, t) => (t < 0.6 ? 0.04 : t < 1 ? 0.4 : 0));
    const [voice] = voiceLevels(energy, midi);
    expect(voice.levels['60/100']!).toBeCloseTo(sineDb(0.4), 0);
  });

  test('ignores the sound after the note-off', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [100]);
    // A gap longer than one energy bin keeps the loud tail out of the last window.
    const energy = shapedNotes(midi, (_, t) => (t < 1 ? 0.1 : t < 1.01 ? 0 : 0.8));
    const [voice] = voiceLevels(energy, midi);
    expect(voice.levels['60/100']!).toBeCloseTo(sineDb(0.1), 1);
  });

  test('reports a silent note below the silent threshold', () => {
    const midi = voiceTestMidi([{ bankMSB: 0, program: 0 }], [60], [64, 100]);
    const energy = shapedNotes(midi, (p, t) => (p.velocity === 100 && t < 1 ? 0.1 : 0));
    const [voice] = voiceLevels(energy, midi);
    const silent = voice.levels['60/64'];
    expect(silent === null || silent! < SILENT_DB).toBe(true);
    expect(voice.levels['60/100']!).toBeCloseTo(sineDb(0.1), 1);
  });

  test('keeps voices that differ only in the bank LSB apart', () => {
    const midi = voiceTestMidi(
      [
        { bankMSB: 0, program: 81 },
        { bankMSB: 0, bankLSB: 18, program: 81 },
      ],
      [60],
      [100],
    );
    const table = voiceLevels(
      toneBursts(midi, 0.3, 1, (p) => (p.bankLSB === 18 ? 0.4 : 0.1)),
      midi,
    );
    expect(table.map((v) => [v.bankMSB, v.bankLSB, v.program])).toEqual([
      [0, undefined, 81],
      [0, 18, 81],
    ]);
    expect('bankLSB' in table[0]).toBe(false);
    expect(table[1].levels['60/100']! - table[0].levels['60/100']!).toBeCloseTo(12.04, 1);
  });
});
