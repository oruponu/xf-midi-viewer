import { beforeAll, describe, expect, test } from 'bun:test';
import { GeneratorTypes, SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank, MIDIPatch } from 'spessasynth_core';
import { buildXgBank, readSoundBank } from '../build.ts';
import { SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { applyCorrections, listUnits } from './apply.ts';
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
    expect(snare.layers.map((l) => [...l.velocity])).toContainEqual([0, 52]);
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

  test('lets an XG variation voice use the corrected base preset', () => {
    const bank = fresh();
    expect(bank.getPreset(patch(0, 6, 81), 'xg')).toBe(bank.getPreset(patch(0, 0, 81), 'xg'));
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
