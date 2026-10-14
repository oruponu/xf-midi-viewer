import { beforeAll, describe, expect, test } from 'bun:test';
import { GeneratorTypes, SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank, MIDIPatch } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import {
  applyCorrections,
  applyRangeCorrections,
  applyVariationCorrections,
  listUnits,
  rangeLimits,
  variationRangeLimits,
} from './apply.ts';
import { NO_CORRECTIONS } from './corrections.ts';
import type { Corrections } from './corrections.ts';

SpessaLog.setLogLevel(false, false, false);

let source: ArrayBuffer;
beforeAll(() => {
  source = readSoundBank(SOURCE_SOUND_BANK_PATH);
});

const fresh = (): BasicSoundBank => buildXgBank(source, NO_CORRECTIONS);
const patch = (
  bankMSB: number,
  bankLSB: number,
  program: number,
  isGMGSDrum = false,
): MIDIPatch => ({
  bankMSB,
  bankLSB,
  program,
  isGMGSDrum,
});
const ATTENUATION = GeneratorTypes.initialAttenuation;

function voiceAttenuations(bank: BasicSoundBank, p: MIDIPatch, system: 'xg' | 'gs', note: number) {
  return bank
    .getPreset(p, system)
    .getVoiceParameters(note, 100)
    .map((v) => v.generators[ATTENUATION]);
}

describe('listUnits', () => {
  test('lists the layers of each XG drum key and the zones of each calibration voice', () => {
    const units = listUnits(fresh());
    const snare = units.drums.find((d) => d.kit === 0 && d.key === 40)!;
    expect(snare.layers.map((l) => [...l.velocity])).toContainEqual([0, 96]);
    expect(snare.layers.every((l) => l.velocityAmount > 0)).toBe(true);
    expect(
      units.voices.find((v) => v.bankMSB === 0 && v.program === 0)!.zones.length,
    ).toBeGreaterThan(0);
    expect(units.voices.every((v) => v.zones.every((z) => z.velocityAmountDelta === 0))).toBe(true);
  });

  test('takes the velocity range of a drum layer from the preset zone as well', () => {
    const tom = listUnits(fresh()).drums.find((d) => d.kit === 0 && d.key === 41)!;
    expect(tom.layers.map((l) => [...l.velocity])).toEqual([
      [0, 48],
      [49, 66],
      [67, 85],
      [86, 102],
      [103, 112],
      [113, 127],
    ]);
  });
});

describe('applyCorrections', () => {
  test('changes nothing with no corrections', () => {
    const bank = fresh();
    const before = listUnits(bank);
    applyCorrections(bank, NO_CORRECTIONS);
    expect(listUnits(bank)).toEqual(before);
  });

  test('sets the attenuation and the velocity amount of corrected drum layers', () => {
    const bank = fresh();
    const snare = listUnits(bank).drums.find((d) => d.kit === 0 && d.key === 40)!;
    const corrected = {
      ...snare,
      layers: snare.layers.map((l) => ({
        ...l,
        attenuation: l.attenuation + 50,
        velocityAmount: 500,
      })),
    };
    applyCorrections(bank, { ...NO_CORRECTIONS, drums: [corrected] });
    expect(listUnits(bank).drums.find((d) => d.kit === 0 && d.key === 40)).toEqual(corrected);
  });

  test('reports the effective velocity amount for a drum layer with its own preset-level modulator', () => {
    const bank = fresh();
    const drum = listUnits(bank).drums.find((d) => d.kit === 25 && d.key === 41)!;
    const velocityAmount = (b: BasicSoundBank) =>
      b
        .getPreset(patch(127, 0, 25), 'xg')
        .getVoiceParameters(41, 100)
        .map((v) =>
          v.modulators
            .filter(
              (m) =>
                m.destination === ATTENUATION &&
                !m.primarySource.isCC &&
                m.primarySource.index === 2,
            )
            .reduce((sum, m) => sum + m.transformAmount, 0),
        );
    expect(velocityAmount(bank)).toEqual(drum.layers.map((l) => l.velocityAmount));

    applyCorrections(bank, {
      ...NO_CORRECTIONS,
      drums: [{ ...drum, layers: drum.layers.map((l) => ({ ...l, velocityAmount: 500 })) }],
    });
    expect(velocityAmount(bank)).toEqual(drum.layers.map(() => 500));
    expect(
      listUnits(bank)
        .drums.find((d) => d.kit === 25 && d.key === 41)!
        .layers.map((l) => l.velocityAmount),
    ).toEqual(drum.layers.map(() => 500));
  });

  test('adds the common attenuation exactly once to every other sound path', () => {
    const before = fresh();
    const after = fresh();
    applyCorrections(after, { ...NO_CORRECTIONS, commonAttenuation: 250 });
    const paths: [MIDIPatch, 'xg' | 'gs', number][] = [
      [patch(0, 0, 0), 'gs', 60],
      [patch(8, 0, 81), 'gs', 60],
      [patch(0, 0, 0, true), 'gs', 38],
      [patch(127, 0, 0), 'xg', 36],
      [patch(126, 0, 0), 'xg', 60],
      [patch(64, 0, 32), 'xg', 60],
    ];
    for (const [p, system, note] of paths) {
      const a = voiceAttenuations(before, p, system, note);
      const b = voiceAttenuations(after, p, system, note);
      expect(b.length).toBe(a.length);
      b.forEach((value, i) => expect(value - a[i]).toBe(100));
    }
  });

  test('does not add the common attenuation twice to an XG kit with no corrected key', () => {
    const before = fresh();
    const after = fresh();
    const units = listUnits(after);
    const corrections: Corrections = {
      ...NO_CORRECTIONS,
      commonAttenuation: 250,
      drums: units.drums
        .filter((d) => d.kit !== 25)
        .map((d) => ({
          ...d,
          layers: d.layers.map((l) => ({ ...l, attenuation: l.attenuation + 250 })),
        })),
    };
    applyCorrections(after, corrections);
    const a = voiceAttenuations(before, patch(127, 0, 25), 'xg', 36);
    const b = voiceAttenuations(after, patch(127, 0, 25), 'xg', 36);
    b.forEach((value, i) => expect(value - a[i]).toBe(100));
  });

  test('keeps the GS drum kits unchanged when XG kit layers are corrected', () => {
    const before = fresh();
    const after = fresh();
    const units = listUnits(after);
    applyCorrections(after, {
      ...NO_CORRECTIONS,
      drums: units.drums.map((d) => ({
        ...d,
        layers: d.layers.map((l) => ({
          ...l,
          attenuation: l.attenuation + 100,
          velocityAmount: 300,
        })),
      })),
    });
    for (const note of [36, 38, 40, 42]) {
      const a = before.getPreset(patch(0, 0, 0, true), 'gs').getVoiceParameters(note, 64);
      const b = after.getPreset(patch(0, 0, 0, true), 'gs').getVoiceParameters(note, 64);
      expect(b.map((v) => [...v.generators])).toEqual(a.map((v) => [...v.generators]));
      expect(b.map((v) => v.modulators.map((m) => m.transformAmount))).toEqual(
        a.map((v) => v.modulators.map((m) => m.transformAmount)),
      );
    }
  });

  test('applies voice corrections to the preset zones and sums the velocity delta', () => {
    const before = fresh();
    const after = fresh();
    const voice = listUnits(after).voices.find((v) => v.bankMSB === 0 && v.program === 81)!;
    applyCorrections(after, {
      ...NO_CORRECTIONS,
      voices: [
        {
          ...voice,
          zones: voice.zones.map((z) => ({
            ...z,
            attenuation: z.attenuation + 250,
            velocityAmountDelta: -120,
          })),
        },
      ],
    });
    const velocityAmount = (bank: BasicSoundBank) =>
      bank
        .getPreset(patch(0, 0, 81), 'xg')
        .getVoiceParameters(60, 100)
        .map((v) =>
          v.modulators
            .filter(
              (m) =>
                m.destination === ATTENUATION &&
                !m.primarySource.isCC &&
                m.primarySource.index === 2,
            )
            .reduce((sum, m) => sum + m.transformAmount, 0),
        );
    expect(velocityAmount(after).map((x, i) => x - velocityAmount(before)[i])).toEqual(
      velocityAmount(before).map(() => -120),
    );
    const a = voiceAttenuations(before, patch(0, 0, 81), 'xg', 60);
    const b = voiceAttenuations(after, patch(0, 0, 81), 'xg', 60);
    b.forEach((value, i) => expect(value - a[i]).toBe(100));
  });

  test('lets an unlisted XG variation use the corrected base preset', () => {
    const bank = fresh();
    expect(bank.getPreset(patch(0, 7, 81), 'xg')).toBe(bank.getPreset(patch(0, 0, 81), 'xg'));
  });

  test('stops with the kit and key when the layers no longer match', () => {
    const bank = fresh();
    const snare = listUnits(bank).drums.find((d) => d.kit === 0 && d.key === 40)!;
    const wrong = {
      ...snare,
      layers: snare.layers.map((l, i) => (i === 0 ? { ...l, sample: 'Nothing' } : l)),
    };
    expect(() => applyCorrections(bank, { ...NO_CORRECTIONS, drums: [wrong] })).toThrow(
      'XG drum kit 0 note 40',
    );
    expect(() =>
      applyCorrections(fresh(), {
        ...NO_CORRECTIONS,
        drums: [{ ...snare, layers: snare.layers.slice(1) }],
      }),
    ).toThrow('XG drum kit 0 note 40');
    expect(() =>
      applyCorrections(fresh(), { ...NO_CORRECTIONS, drums: [{ ...snare, kit: 5 }] }),
    ).toThrow('XG drum kit 5 not found');
  });

  test('rejects an XG kit zone that covers several keys', () => {
    const bank = fresh();
    const snare = listUnits(bank).drums.find((d) => d.kit === 0 && d.key === 40)!;
    const standard = bank.presets.find(
      (p) => p.bankMSB === 127 && p.program === 0 && p.name.startsWith('XG '),
    )!;
    const zone = standard.zones
      .flatMap((pz) => pz.instrument.zones)
      .find((z) => z.keyRange.min === 40)!;
    zone.keyRange = { min: 40, max: 41 };
    expect(() => listUnits(bank)).toThrow('several keys');
    expect(() => applyCorrections(bank, { ...NO_CORRECTIONS, drums: [snare] })).toThrow(
      'several keys',
    );
  });

  test('stops with the voice when the zones no longer match', () => {
    const bank = fresh();
    const voice = listUnits(bank).voices.find((v) => v.bankMSB === 0 && v.program === 0)!;
    const wrong = { ...voice, zones: voice.zones.map((z) => ({ ...z, instrument: 'Nothing' })) };
    expect(() => applyCorrections(bank, { ...NO_CORRECTIONS, voices: [wrong] })).toThrow(
      'Voice MSB 0 / PC 0',
    );
  });

  test('stops when the total attenuation would exceed 1440', () => {
    expect(() => applyCorrections(fresh(), { ...NO_CORRECTIONS, commonAttenuation: 1440 })).toThrow(
      '1440',
    );
  });
});

describe('applyVariationCorrections', () => {
  const velocityAmount = (bank: BasicSoundBank, p: MIDIPatch, note = 60) =>
    bank
      .getPreset(p, 'xg')
      .getVoiceParameters(note, 100)
      .map((v) =>
        v.modulators
          .filter(
            (m) =>
              m.destination === ATTENUATION && !m.primarySource.isCC && m.primarySource.index === 2,
          )
          .reduce((sum, m) => sum + m.transformAmount, 0),
      );

  test('adds the deltas to every preset zone of the variation', () => {
    const before = fresh();
    const after = fresh();
    applyVariationCorrections(after, [
      { program: 81, bankLSB: 18, attenuationDelta: 250, velocityAmountDelta: -120 },
    ]);
    const a = voiceAttenuations(before, patch(0, 18, 81), 'xg', 60);
    const b = voiceAttenuations(after, patch(0, 18, 81), 'xg', 60);
    expect(b.length).toBeGreaterThan(0);
    b.forEach((value, i) => expect(value - a[i]).toBe(100));
    const va = velocityAmount(before, patch(0, 18, 81));
    expect(velocityAmount(after, patch(0, 18, 81)).map((x, i) => x - va[i])).toEqual(
      va.map(() => -120),
    );
  });

  test('does not touch the base voice when correcting its variation', () => {
    const before = fresh();
    const after = fresh();
    applyVariationCorrections(after, [
      { program: 81, bankLSB: 18, attenuationDelta: 250, velocityAmountDelta: -120 },
    ]);
    expect(voiceAttenuations(after, patch(0, 0, 81), 'xg', 60)).toEqual(
      voiceAttenuations(before, patch(0, 0, 81), 'xg', 60),
    );
    expect(velocityAmount(after, patch(0, 0, 81))).toEqual(velocityAmount(before, patch(0, 0, 81)));
  });

  test('stops at a variation that has no preset or is corrected twice', () => {
    const zero = { attenuationDelta: 0, velocityAmountDelta: 0 };
    expect(() =>
      applyVariationCorrections(fresh(), [{ program: 81, bankLSB: 7, ...zero }]),
    ).toThrow('XG variation LSB 7 / PC 81 not found');
    expect(() =>
      applyVariationCorrections(fresh(), [
        { program: 81, bankLSB: 18, ...zero },
        { program: 81, bankLSB: 18, ...zero },
      ]),
    ).toThrow('XG variation LSB 18 / PC 81 is corrected twice');
  });

  test('lets a variation go above the maximum total attenuation and reports the zones', () => {
    const over = applyVariationCorrections(fresh(), [
      { program: 81, bankLSB: 18, attenuationDelta: 1440, velocityAmountDelta: 0 },
    ]);
    expect(over.length).toBeGreaterThan(0);
    for (const line of over)
      expect(line).toMatch(/^XG .+ \/ .+: total attenuation \d+ exceeds 1440$/);
  });

  test('reports no zone while the variations stay within the maximum total attenuation', () => {
    expect(
      applyVariationCorrections(fresh(), [
        { program: 81, bankLSB: 18, attenuationDelta: 250, velocityAmountDelta: 0 },
      ]),
    ).toEqual([]);
  });

  test('stops when a variation correction brings the total attenuation below 0', () => {
    expect(() =>
      applyVariationCorrections(fresh(), [
        { program: 81, bankLSB: 18, attenuationDelta: -1440, velocityAmountDelta: 0 },
      ]),
    ).toThrow('below 0');
  });

  const MODULR = { program: 39, bankLSB: 40 };
  const RISE = [
    { key: 60, attenuationDelta: 0 },
    { key: 72, attenuationDelta: 30 },
  ];

  test('adds the stepped delta of each note to the variation', () => {
    const before = fresh();
    const after = fresh();
    applyVariationCorrections(after, [], [{ ...MODULR, keys: RISE }]);
    // Stepped deltas 0 / 5 / 10 / 15 / 30 cB; the synth multiplies attenuation by 0.4.
    for (const [note, expected] of [
      [40, 0],
      [60, 0],
      [61, 2],
      [63, 4],
      [65, 6],
      [72, 12],
      [100, 12],
    ]) {
      const a = voiceAttenuations(before, patch(0, 40, 39), 'xg', note);
      const b = voiceAttenuations(after, patch(0, 40, 39), 'xg', note);
      expect(b.length).toBeGreaterThan(0);
      expect(b.map((value, i) => value - a[i])).toEqual(a.map(() => expected));
    }
  });

  test('splits each preset zone only inside its own keys and merges equal deltas', () => {
    const bank = fresh();
    applyVariationCorrections(bank, [], [{ ...MODULR, keys: RISE }]);
    const zones = bank.getPreset(patch(0, 40, 39), 'xg').zones;
    // 0-60, 61-62, 63-64, 65-66, 67-68, 69-70, 71-74 for each of the two 0-74 zones, 75-108 once.
    expect(zones.length).toBe(15);
    expect(zones.every((z) => z.keyRange.max <= 74 || z.keyRange.min >= 75)).toBe(true);
    expect(Math.min(...zones.map((z) => z.keyRange.min))).toBe(0);
    expect(Math.max(...zones.map((z) => z.keyRange.max))).toBe(108);
  });

  test('keeps the velocity amount on the zones it splits off', () => {
    const before = fresh();
    const after = fresh();
    applyVariationCorrections(
      after,
      [{ ...MODULR, attenuationDelta: 0, velocityAmountDelta: -120 }],
      [{ ...MODULR, keys: RISE }],
    );
    expect(velocityAmount(after, patch(0, 40, 39), 61)).toEqual(
      velocityAmount(before, patch(0, 40, 39), 61).map((x) => x - 120),
    );
  });

  test('leaves every other preset alone when splitting a variation', () => {
    const shape = (bank: BasicSoundBank) =>
      bank.presets
        .filter((p) => !(p.bankMSB === 0 && p.bankLSB === 40 && p.program === 39))
        .map((p) =>
          p.zones.map((z) => [z.keyRange.min, z.keyRange.max, z.getGenerator(ATTENUATION, 0)]),
        );
    const before = fresh();
    const after = fresh();
    applyVariationCorrections(after, [], [{ ...MODULR, keys: RISE }]);
    expect(shape(after)).toEqual(shape(before));
  });

  test('stops at a variation range correction that has no preset or comes twice', () => {
    expect(() =>
      applyVariationCorrections(fresh(), [], [{ program: 81, bankLSB: 7, keys: RISE }]),
    ).toThrow('XG variation LSB 7 / PC 81 not found');
    expect(() =>
      applyVariationCorrections(
        fresh(),
        [],
        [
          { ...MODULR, keys: RISE },
          { ...MODULR, keys: RISE },
        ],
      ),
    ).toThrow('XG variation LSB 40 / PC 39 has two range corrections');
  });

  test('lets a variation range correction go above 1440 but not below 0', () => {
    const over = applyVariationCorrections(
      fresh(),
      [],
      [{ ...MODULR, keys: [{ key: 60, attenuationDelta: 1440 }] }],
    );
    expect(over.length).toBeGreaterThan(0);
    expect(() =>
      applyVariationCorrections(
        fresh(),
        [],
        [{ ...MODULR, keys: [{ key: 60, attenuationDelta: -1440 }] }],
      ),
    ).toThrow('below 0');
  });

  test('applies the variation range corrections in the build', () => {
    const before = fresh();
    const after = buildXgBank(source, {
      ...NO_CORRECTIONS,
      variationRanges: [{ ...MODULR, keys: RISE }],
    });
    const a = voiceAttenuations(before, patch(0, 40, 39), 'xg', 72);
    expect(voiceAttenuations(after, patch(0, 40, 39), 'xg', 72)).toEqual(a.map((x) => x + 12));
  });
});

describe('applyRangeCorrections', () => {
  const SAW = { bankMSB: 0, program: 81 };
  const RISE = [
    { key: 60, attenuationDelta: 0 },
    { key: 72, attenuationDelta: 60 },
  ];

  test('adds the interpolated delta to each note of the voice', () => {
    const before = fresh();
    const after = fresh();
    applyRangeCorrections(after, [{ ...SAW, keys: RISE }]);
    // The synth multiplies attenuation by 0.4, so 15 / 30 / 60 cB become 6 / 12 / 24.
    for (const [note, expected] of [
      [20, 0],
      [60, 0],
      [63, 6],
      [66, 12],
      [72, 24],
      [100, 24],
    ]) {
      const a = voiceAttenuations(before, patch(0, 0, 81), 'xg', note);
      const b = voiceAttenuations(after, patch(0, 0, 81), 'xg', note);
      expect(b.length).toBeGreaterThan(0);
      expect(b.map((value, i) => value - a[i])).toEqual(a.map(() => expected));
    }
  });

  test('leaves the other presets that share its instruments alone', () => {
    const bank = fresh();
    const base = bank.getPreset(patch(0, 0, 81), 'xg');
    const instruments = new Set(base.zones.map((z) => z.instrument));
    const others = bank.presets.filter(
      (p) => p !== base && p.zones.some((z) => instruments.has(z.instrument)),
    );
    expect(others.length).toBeGreaterThan(0);
    const levels = () =>
      others.map((p) => p.getVoiceParameters(72, 100).map((v) => v.generators[ATTENUATION]));
    const before = levels();
    applyRangeCorrections(bank, [{ ...SAW, keys: RISE }]);
    expect(base.zones.some((z) => instruments.has(z.instrument))).toBe(false);
    expect(levels()).toEqual(before);
  });

  test('stops at a voice that is missing or corrected twice', () => {
    expect(() =>
      applyRangeCorrections(fresh(), [{ bankMSB: 100, program: 0, keys: RISE }]),
    ).toThrow('Voice MSB 100 / PC 0 not found');
    expect(() =>
      applyRangeCorrections(fresh(), [
        { ...SAW, keys: RISE },
        { ...SAW, keys: RISE },
      ]),
    ).toThrow('Voice MSB 0 / PC 81 has two range corrections');
  });

  test('stops when a range correction brings the total attenuation out of 0 to 1440', () => {
    expect(() =>
      applyRangeCorrections(fresh(), [{ ...SAW, keys: [{ key: 60, attenuationDelta: -1440 }] }]),
    ).toThrow('below 0');
    expect(() =>
      applyRangeCorrections(fresh(), [{ ...SAW, keys: [{ key: 60, attenuationDelta: 1440 }] }]),
    ).toThrow('exceeds 1440');
  });
});

describe('rangeLimits', () => {
  test('matches the build check for a delta that is the same at every note', () => {
    const SAW = { bankMSB: 0, program: 81 };
    const limit = rangeLimits(fresh());
    const limits = Array.from({ length: 128 }, (_, note) => limit(SAW, note));
    const lowest = Math.max(...limits.map((l) => l.min).filter(Number.isFinite));
    const highest = Math.min(...limits.map((l) => l.max).filter(Number.isFinite));
    const flat = (attenuationDelta: number) => [{ ...SAW, keys: [{ key: 60, attenuationDelta }] }];
    expect(() => applyRangeCorrections(fresh(), flat(lowest))).not.toThrow();
    expect(() => applyRangeCorrections(fresh(), flat(lowest - 1))).toThrow('below 0');
    expect(() => applyRangeCorrections(fresh(), flat(highest))).not.toThrow();
    expect(() => applyRangeCorrections(fresh(), flat(highest + 1))).toThrow('exceeds 1440');
  });
});

describe('variationRangeLimits', () => {
  const MODULR = { program: 39, bankLSB: 40 };

  test('matches the build check note by note', () => {
    const limit = variationRangeLimits(fresh());
    const atLimit = (note: number) => {
      const { min } = limit(MODULR, note);
      return Number.isFinite(min) ? Math.ceil(min / 5) * 5 : 0;
    };
    const keys = Array.from({ length: 128 }, (_, key) => ({ key, attenuationDelta: atLimit(key) }));
    expect(() => applyVariationCorrections(fresh(), [], [{ ...MODULR, keys }])).not.toThrow();
    const lowered = keys.map((k) =>
      k.key === 60 ? { ...k, attenuationDelta: k.attenuationDelta - 5 } : k,
    );
    expect(() => applyVariationCorrections(fresh(), [], [{ ...MODULR, keys: lowered }])).toThrow(
      'below 0',
    );
    expect(limit(MODULR, 60).max).toBe(Infinity);
  });

  test('pairs a split zone only with the instrument zones its keys reach', () => {
    // The base voice's range correction gives its instrument zones different attenuation per key.
    const corrections = {
      ...NO_CORRECTIONS,
      ranges: [
        {
          bankMSB: 0,
          program: 39,
          keys: [
            { key: 36, attenuationDelta: 0 },
            { key: 72, attenuationDelta: 400 },
          ],
        },
      ],
    };
    const limit = variationRangeLimits(buildXgBank(source, corrections));
    const keys = Array.from({ length: 128 }, (_, key) => {
      const { min } = limit(MODULR, key);
      return { key, attenuationDelta: Number.isFinite(min) ? Math.ceil(min / 5) * 5 : 0 };
    });
    expect(keys.some((k) => k.attenuationDelta < 0)).toBe(true);
    expect(() =>
      buildXgBank(source, { ...corrections, variationRanges: [{ ...MODULR, keys }] }),
    ).not.toThrow();
  });
});
