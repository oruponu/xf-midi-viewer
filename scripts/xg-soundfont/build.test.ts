import { beforeAll, describe, expect, test } from 'bun:test';
import { GeneratorTypes, SoundBankLoader, SpessaLog } from 'spessasynth_core';
import type { BasicPreset, BasicSoundBank, MIDIPatch, Modulator } from 'spessasynth_core';
import { buildXgBank, buildXgSoundBank, readSoundBank, sourceSha256 } from './build.ts';
import { NO_CORRECTIONS, readCorrections } from './calibration/corrections.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from './paths.ts';
import { XG_KITS } from './xgDrumKits.ts';
import { XG_SFX_VOICES } from './xgSfxVoices.ts';
import { XG_VARIATION_VOICES } from './xgVariationVoices.ts';

SpessaLog.setLogLevel(false, false, false);

let source: BasicSoundBank;
let built: BasicSoundBank;

beforeAll(() => {
  const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
  source = SoundBankLoader.fromArrayBuffer(data.slice(0));
  built = SoundBankLoader.fromArrayBuffer(buildXgSoundBank(data, NO_CORRECTIONS));
});

const patch = (bankMSB: number, program: number, isGMGSDrum = false): MIDIPatch => ({
  bankMSB,
  bankLSB: 0,
  program,
  isGMGSDrum,
});

describe('buildXgSoundBank', () => {
  test('selects the XG kits by exact match in XG mode', () => {
    for (const kit of XG_KITS) {
      const preset = built.getPreset(patch(kit.bankMSB, kit.program), 'xg');
      expect([preset.name, preset.bankMSB, preset.program]).toEqual([
        `XG ${kit.name}`,
        kit.bankMSB,
        kit.program,
      ]);
    }
  });

  test('treats the XG drum kits as drums', () => {
    for (const kit of XG_KITS.filter((k) => k.bankMSB === 127)) {
      expect(built.getPreset(patch(127, kit.program), 'xg').isDrum).toBe(true);
    }
  });

  test('selects the SFX voices by exact match in XG mode', () => {
    for (const sfx of XG_SFX_VOICES) {
      const preset = built.getPreset(patch(64, sfx.program), 'xg');
      expect([preset.name, preset.bankMSB, preset.program]).toEqual([
        `XG ${sfx.name}`,
        64,
        sfx.program,
      ]);
    }
  });

  test('selects the XG variation voices by exact match in XG mode', () => {
    for (const variation of XG_VARIATION_VOICES) {
      const preset = built.getPreset(
        { bankMSB: 0, bankLSB: variation.bankLSB, program: variation.program, isGMGSDrum: false },
        'xg',
      );
      expect([preset.name, preset.bankMSB, preset.bankLSB, preset.program]).toEqual([
        `XG ${variation.name}`,
        0,
        variation.bankLSB,
        variation.program,
      ]);
    }
  });

  test('keeps the GS variation in the bank that shares its number', () => {
    for (const system of ['xg', 'gs', 'gm'] as const) {
      expect(built.getPreset(patch(16, 25), system).name).toBe(
        source.getPreset(patch(16, 25), system).name,
      );
    }
  });

  test('reports the variation zones above the maximum total attenuation', () => {
    const warnings: string[] = [];
    buildXgBank(
      readSoundBank(SOURCE_SOUND_BANK_PATH),
      {
        ...NO_CORRECTIONS,
        variations: [{ program: 81, bankLSB: 18, attenuationDelta: 1440, velocityAmountDelta: 0 }],
      },
      (message) => warnings.push(message),
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('exceeds 1440');
  });

  test('links the XG variations and the GS fallbacks to the range-corrected instruments', () => {
    const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
    const plain = buildXgBank(data, NO_CORRECTIONS);
    const ranged = buildXgBank(data, {
      ...NO_CORRECTIONS,
      ranges: [
        {
          bankMSB: 0,
          program: 81,
          keys: [
            { key: 60, attenuationDelta: 0 },
            { key: 72, attenuationDelta: 60 },
          ],
        },
      ],
    });
    const at72 = (bank: BasicSoundBank, p: BasicPreset) =>
      bank.presets
        .find(
          (x) =>
            x.name === p.name &&
            x.bankMSB === p.bankMSB &&
            x.bankLSB === p.bankLSB &&
            x.program === p.program,
        )!
        .getVoiceParameters(72, 100)
        .map((v) => v.generators[GeneratorTypes.initialAttenuation]);
    const baseName = plain.getPreset(patch(0, 81), 'xg').name;
    const copies = plain.presets.filter(
      (p) =>
        !p.isGMGSDrum &&
        p.program === 81 &&
        ((p.bankMSB === 0 && p.bankLSB !== 0 && p.name.startsWith('XG ')) ||
          (p.bankMSB !== 0 && p.bankLSB === 0 && p.name === baseName)),
    );
    expect(copies.some((p) => p.bankLSB === 18)).toBe(true);
    for (const p of copies) {
      const before = at72(plain, p);
      expect(at72(ranged, p).map((v, i) => v - before[i])).toEqual(before.map(() => 24));
    }
  });

  test('plays the XG variation voices exactly like their corrected source', () => {
    const bank = SoundBankLoader.fromArrayBuffer(
      buildXgSoundBank(readSoundBank(SOURCE_SOUND_BANK_PATH), {
        ...readCorrections(CORRECTIONS_PATH),
        variations: [],
        variationRanges: [],
      }),
    );
    const voices = (preset: BasicPreset) =>
      [36, 48, 60, 72, 84].flatMap((key) =>
        [40, 100].flatMap((velocity) =>
          preset
            .getVoiceParameters(key, velocity)
            .map((v) => ({ sample: v.sample.name, generators: [...v.generators] })),
        ),
      );
    for (const variation of XG_VARIATION_VOICES) {
      const alias = bank.getPreset(
        { bankMSB: 0, bankLSB: variation.bankLSB, program: variation.program, isGMGSDrum: false },
        'xg',
      );
      const original = bank.getPreset(patch(variation.from.bankMSB, variation.from.program), 'xg');
      expect(alias.name).toBe(`XG ${variation.name}`);
      expect(voices(alias).length).toBeGreaterThan(0);
      expect(voices(alias)).toEqual(voices(original));
    }
  });

  test('selects XG DynaSaw for MSB 0 / LSB 18 / PC 81 in XG mode', () => {
    const preset = built.getPreset(
      { bankMSB: 0, bankLSB: 18, program: 81, isGMGSDrum: false },
      'xg',
    );
    expect(preset.name).toBe('XG DynaSaw');
  });

  test('changes only the attenuation and the velocity amount of a corrected variation', () => {
    const ATTENUATION = GeneratorTypes.initialAttenuation;
    const isVelocity = (m: Modulator) =>
      m.destination === ATTENUATION && !m.primarySource.isCC && m.primarySource.index === 2;
    const parts = (preset: BasicPreset, key: number, velocity: number) =>
      preset.getVoiceParameters(key, velocity).map((v) => ({
        sample: v.sample.name,
        attenuation: v.generators[ATTENUATION],
        others: [...v.generators].filter((_, i) => i !== ATTENUATION),
        velocityAmount: v.modulators.filter(isVelocity).reduce((s, m) => s + m.transformAmount, 0),
        otherModulators: v.modulators
          .filter((m) => !isVelocity(m))
          .map((m) => [
            m.destination,
            m.transformAmount,
            m.transformType,
            m.primarySource.toSourceEnum(),
            m.secondarySource.toSourceEnum(),
          ]),
      }));
    const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
    for (const [attenuationDelta, velocityAmountDelta] of [
      [250, 0],
      [0, -120],
      [250, -120],
    ]) {
      const bank = buildXgBank(data, {
        ...NO_CORRECTIONS,
        variations: [{ program: 81, bankLSB: 18, attenuationDelta, velocityAmountDelta }],
      });
      const alias = bank.getPreset(
        { bankMSB: 0, bankLSB: 18, program: 81, isGMGSDrum: false },
        'xg',
      );
      const original = bank.getPreset(patch(0, 81), 'xg');
      expect(alias.name).toBe('XG DynaSaw');
      for (const key of [48, 60, 72]) {
        for (const velocity of [40, 100]) {
          const a = parts(alias, key, velocity);
          const o = parts(original, key, velocity);
          expect(a.length).toBeGreaterThan(0);
          expect(a.length).toBe(o.length);
          a.forEach((p, i) => {
            expect(p.sample).toBe(o[i].sample);
            expect(p.others).toEqual(o[i].others);
            expect(p.otherModulators).toEqual(o[i].otherModulators);
            expect(p.attenuation - o[i].attenuation).toBe(attenuationDelta * 0.4);
            expect(p.velocityAmount - o[i].velocityAmount).toBe(velocityAmountDelta);
          });
        }
      }
    }
  });

  test('is recognized as an XG sound bank', () => {
    expect(built.isXGBank).toBe(true);
  });

  test('keeps every original preset and their GS and GM selection', () => {
    const gsFallbacks = XG_VARIATION_VOICES.filter(
      ({ bankLSB, program }) =>
        !source.presets.some((p) => p.bankMSB === bankLSB && p.program === program) &&
        !(bankLSB === 64 && XG_SFX_VOICES.some((sfx) => sfx.program === program)),
    );
    expect(gsFallbacks.length).toBe(289);
    expect(built.presets.length).toBe(
      source.presets.length +
        XG_KITS.length +
        XG_SFX_VOICES.length +
        XG_VARIATION_VOICES.length +
        gsFallbacks.length,
    );
    for (const original of source.presets) {
      const p = patch(original.bankMSB, original.program, original.isGMGSDrum);
      for (const system of ['gs', 'gm'] as const) {
        expect(built.getPreset(p, system).name).toBe(source.getPreset(p, system).name);
      }
    }
  });

  test('never falls back to an XG variation for a GS or GM selection with LSB 0', () => {
    for (const system of ['gs', 'gm'] as const) {
      for (let bankMSB = 0; bankMSB < 126; bankMSB++) {
        for (let program = 0; program < 128; program++) {
          const preset = built.getPreset(patch(bankMSB, program), system);
          expect(
            preset.bankMSB === 0 && preset.bankLSB !== 0,
            `${system} MSB ${bankMSB} / PC ${program} -> ${preset.name}`,
          ).toBe(false);
        }
      }
    }
  });

  test('plays the base voice for a GS bank that only an XG variation has the number of', () => {
    const bank = SoundBankLoader.fromArrayBuffer(
      buildXgSoundBank(readSoundBank(SOURCE_SOUND_BANK_PATH), readCorrections(CORRECTIONS_PATH)),
    );
    const voices = (preset: BasicPreset) =>
      [48, 60, 72].flatMap((key) =>
        preset.getVoiceParameters(key, 100).map((v) => ({
          sample: v.sample.name,
          generators: [...v.generators],
          modulators: v.modulators.map((m) => [m.destination, m.transformAmount]),
        })),
      );
    for (const [bankMSB, program] of [
      [8, 40],
      [16, 24],
      [6, 39],
    ]) {
      expect(source.presets.some((p) => p.bankMSB === bankMSB && p.program === program)).toBe(
        false,
      );
      const fallback = bank.getPreset(patch(bankMSB, program), 'gs');
      expect(voices(fallback)).toEqual(voices(bank.getPreset(patch(0, program), 'gs')));
    }
  });

  test('leaves the XG drum kits silent outside notes 13 to 84', () => {
    const standard = built.getPreset(patch(127, 0), 'xg');
    for (const note of [0, 12, 85, 86, 87, 127]) {
      expect(standard.getVoiceParameters(note, 100)).toEqual([]);
    }
  });

  test('keeps the previous selection for XG kit programs not in the MU50', () => {
    for (const program of [5, 26, 127]) {
      for (const system of ['xg', 'gs'] as const) {
        const p = patch(127, program);
        expect(built.getPreset(p, system).name).toBe(source.getPreset(p, system).name);
      }
    }
  });

  test('selects the added XG presets for their bank and program even in GS mode (known limitation)', () => {
    expect(built.getPreset(patch(127, 0), 'gs').name).toBe('XG Standard Kit');
    expect(built.getPreset(patch(126, 0), 'gs').name).toBe('XG SFX 1');
    expect(built.getPreset(patch(64, 0), 'gs').name).toBe('XG Cutting Noise');
  });

  test('adds no samples', () => {
    expect(built.samples.length).toBe(source.samples.length);
  });

  test('stops when the source differs from the one the corrections were fitted to', () => {
    const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
    expect(() => buildXgBank(data, { ...NO_CORRECTIONS, sourceSha256: '0'.repeat(64) })).toThrow(
      'fitted to',
    );
    expect(() =>
      buildXgBank(data, { ...NO_CORRECTIONS, sourceSha256: sourceSha256(data) }),
    ).not.toThrow();
  });

  test('builds with the committed corrections file', () => {
    const data = readSoundBank(SOURCE_SOUND_BANK_PATH);
    const bank = SoundBankLoader.fromArrayBuffer(
      buildXgSoundBank(data, readCorrections(CORRECTIONS_PATH)),
    );
    expect(bank.samples.length).toBe(source.samples.length);
    expect(bank.presets.length).toBe(built.presets.length);
  });
});
