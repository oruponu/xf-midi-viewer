import { describe, expect, test } from 'bun:test';
import { calibrate } from './calibrate.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import type { CalibrationUnits, Corrections, ExcludedUnit } from './corrections.ts';
import type { LevelTable } from './levels.ts';

const UNITS: CalibrationUnits = {
  drums: [
    {
      kit: 0,
      key: 36,
      layers: [{ velocity: [0, 127], sample: 'Kick', attenuation: 0, velocityAmount: 900 }],
    },
    {
      kit: 0,
      key: 40,
      layers: [
        { velocity: [0, 52], sample: 'Snare Soft', attenuation: 120, velocityAmount: 900 },
        { velocity: [53, 127], sample: 'Snare Hard', attenuation: 60, velocityAmount: 900 },
      ],
    },
  ],
  voices: [
    {
      bankMSB: 0,
      program: 0,
      zones: [{ instrument: 'Piano', attenuation: 0, velocityAmountDelta: 0 }],
    },
    {
      bankMSB: 0,
      program: 1,
      zones: [{ instrument: 'Bright', attenuation: 100, velocityAmountDelta: 0 }],
    },
  ],
};
const DRUM_VELOCITIES = [24, 32, 48, 64, 96, 127];
const BASE = -30;
// Both snare layers share the same gap, so the reference keeps the measured velocity slope.
const REFERENCE_GAP: Record<string, number> = {
  '0/36': 10,
  '0/40/0': 12,
  '0/40/53': 12,
  '0/0': 4,
  '0/1': 13,
};

function layerOf(corrections: Corrections, key: number, velocity: number) {
  const drum = corrections.drums.find((d) => d.key === key);
  const start = UNITS.drums.find((d) => d.key === key)!;
  const index = start.layers.findIndex(
    (l) => velocity >= l.velocity[0] && velocity <= l.velocity[1],
  );
  return {
    now: drum
      ? drum.layers[index].attenuation
      : start.layers[index].attenuation + corrections.commonAttenuation,
    start: start.layers[index].attenuation,
    amount: drum ? drum.layers[index].velocityAmount : start.layers[index].velocityAmount,
    id: `0/${key}/${start.layers[index].velocity[0]}`,
  };
}

type Tweak = (unit: string, level: number, attenuation: number) => number | null;

// Levels drop 1 dB per 25 of attenuation above the start, and drum levels follow the velocity
// amount: 900 gives 9 dB per doubling of velocity.
function fakeMeasure(tweak: Tweak = (_, l) => l) {
  return (corrections: Corrections): LevelTable => ({
    drums: UNITS.drums.map((d) => ({
      kit: d.kit,
      key: d.key,
      levels: Object.fromEntries(
        DRUM_VELOCITIES.map((v) => {
          const layer = layerOf(corrections, d.key, v);
          const unit = d.key === 36 ? '0/36' : layer.id;
          const level =
            BASE - (layer.now - layer.start) / 25 + (layer.amount / 900) * 9 * Math.log2(v / 64);
          return [String(v), tweak(unit, level, layer.now)];
        }),
      ),
    })),
    voices: UNITS.voices.map((voice) => {
      const found = corrections.voices.find((c) => c.program === voice.program);
      const now = found
        ? found.zones[0].attenuation
        : voice.zones[0].attenuation + corrections.commonAttenuation;
      const unit = `0/${voice.program}`;
      return {
        bankMSB: 0,
        program: voice.program,
        levels: {
          '60/64': tweak(unit, BASE - (now - voice.zones[0].attenuation) / 25, now),
          '60/127': tweak(unit, BASE - (now - voice.zones[0].attenuation) / 25, now),
        },
      };
    }),
  });
}

function reference(overrides: Record<string, number | null> = {}): LevelTable {
  const measured = fakeMeasure()({ ...NO_CORRECTIONS, ...UNITS });
  return {
    drums: measured.drums.map((d) => ({
      ...d,
      levels: Object.fromEntries(
        Object.entries(d.levels).map(([v, level]) => {
          const unit = d.key === 36 ? '0/36' : Number(v) <= 52 ? '0/40/0' : '0/40/53';
          return [v, unit in overrides ? overrides[unit] : level! + REFERENCE_GAP[unit]];
        }),
      ),
    })),
    voices: measured.voices.map((v) => ({
      ...v,
      levels: Object.fromEntries(
        Object.entries(v.levels).map(([k, level]) => {
          const unit = `0/${v.program}`;
          return [k, unit in overrides ? overrides[unit] : level! + REFERENCE_GAP[unit]];
        }),
      ),
    })),
  };
}

const run = (excluded: ExcludedUnit[] = [], ref = reference(), measure = fakeMeasure()) =>
  calibrate({ units: UNITS, reference: ref, excluded, measure });

describe('calibrate', () => {
  test('lowers every unit to the reference balance with the largest gap as the common shift', () => {
    const result = run();
    expect(result.passed).toBe(true);
    expect(result.corrections.commonAttenuation).toBe(13 * 25);
    expect(result.corrections.drums.find((d) => d.key === 36)!.layers[0].attenuation).toBe(75);
    expect(
      result.corrections.drums.find((d) => d.key === 40)!.layers.map((l) => l.attenuation),
    ).toEqual([145, 85]);
    expect(result.corrections.drums.flatMap((d) => d.layers.map((l) => l.velocityAmount))).toEqual([
      900, 900, 900,
    ]);
    expect(result.corrections.voices.map((v) => v.zones[0].attenuation)).toEqual([225, 100]);
    expect(result.drums.max).toBeLessThan(0.05);
    expect(result.voices.max).toBeLessThan(0.05);
  });

  test('keeps excluded units out of the common shift and the correction lists', () => {
    const result = run([{ bankMSB: 0, program: 1 }], reference({ '0/1': BASE + 20 }));
    expect(result.corrections.commonAttenuation).toBe(12 * 25);
    expect(result.corrections.voices.map((v) => v.program)).toEqual([0]);
    expect(result.corrections.excluded).toEqual([{ bankMSB: 0, program: 1 }]);
  });

  test('refuses an excluded entry that matches no unit', () => {
    expect(() => run([{ kit: 0, key: 99 }])).toThrow('Excluded entry {"kit":0,"key":99}');
  });

  test('gives units without valid reference points only the common attenuation', () => {
    const result = run([], reference({ '0/1': null }));
    expect(result.unmeasured).toContain('voice 0/1');
    const voice = result.corrections.voices.find((v) => v.program === 1)!;
    expect(voice.zones[0].attenuation).toBe(100 + result.corrections.commonAttenuation);
    expect(result.passed).toBe(true);
  });

  test('raises the common shift when a unit cannot get loud enough', () => {
    // After the two measurements that set the common shift, the kick reads 4 dB quieter,
    // 1 dB more than its attenuation can make up.
    let measurements = 0;
    const quieter = fakeMeasure((unit, level) =>
      unit === '0/36' && measurements > 2 ? level - 4 : level,
    );
    const result = run([], reference(), (corrections) => {
      measurements++;
      return quieter(corrections);
    });
    expect(result.passed).toBe(true);
    expect(result.corrections.commonAttenuation).toBe(14 * 25);
    expect(result.corrections.drums.find((d) => d.key === 36)!.layers[0].attenuation).toBe(0);
  });

  test('restores the velocity setting of layers without valid points', () => {
    const ref = reference();
    const snare = ref.drums.find((d) => d.key === 40)!;
    const drums = ref.drums.map((d) =>
      d === snare
        ? {
            ...d,
            levels: Object.fromEntries(
              Object.keys(d.levels).map((v) => [
                v,
                Number(v) <= 52 ? null : BASE + 12 + 7 * Math.log2(Number(v) / 64),
              ]),
            ),
          }
        : d,
    );
    const result = run([], { ...ref, drums });
    const layers = result.corrections.drums.find((d) => d.key === 40)!.layers;
    expect(layers[0].velocityAmount).toBe(900);
    expect(layers[1].velocityAmount).toBe(700);
    expect(result.unmeasured).toContain('drum 0/40 0-52');
  });

  test('stops when a point measured at the start can no longer be measured', () => {
    const vanishing = fakeMeasure((unit, level, attenuation) =>
      unit === '0/0' && attenuation > 0 ? null : level,
    );
    expect(() => run([], reference(), vanishing)).toThrow('voice 0/0 point');
  });

  test('fails when the error criteria are not met', () => {
    let n = 0;
    const noisy = fakeMeasure((_, level) => level + (n++ % 2 === 0 ? 3 : -3));
    const result = run([], reference(), noisy);
    expect(result.passed).toBe(false);
    expect(
      result.drums.median > 0.5 ||
        result.drums.p90 > 2 ||
        result.voiceMeans.median > 0.5 ||
        result.voiceMeans.p90 > 2,
    ).toBe(true);
  });

  test('judges voices by their mean error and still reports the error of each point', () => {
    const ref = reference();
    const voices = ref.voices.map((v) => ({
      ...v,
      levels: { '60/64': v.levels['60/64']! + 3, '60/127': v.levels['60/127']! - 3 },
    }));
    const result = run([], { ...ref, voices });
    expect(result.passed).toBe(true);
    expect(result.voiceMeans.max).toBeLessThan(0.05);
    expect(result.voices.median).toBeCloseTo(3, 1);
  });

  test('fails when the attenuation floor is still reached after all retries', () => {
    let measurements = 0;
    const growing = fakeMeasure((unit, level) =>
      unit === '0/36' && measurements > 2 ? level - 10 * measurements : level,
    );
    const result = run([], reference(), (corrections) => {
      measurements++;
      return growing(corrections);
    });
    expect(result.passed).toBe(false);
  });

  test('refuses a reference quieter than the sound bank for every unit', () => {
    const ref = reference();
    const quiet: LevelTable = {
      drums: ref.drums.map((d) => ({
        ...d,
        levels: Object.fromEntries(
          Object.entries(d.levels).map(([v, level]) => [v, level === null ? null : level - 20]),
        ),
      })),
      voices: ref.voices.map((v) => ({
        ...v,
        levels: Object.fromEntries(
          Object.entries(v.levels).map(([k, level]) => [k, level === null ? null : level - 20]),
        ),
      })),
    };
    expect(() => run([], quiet)).toThrow('common shift would be negative');
  });
});
