import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { SoundBankLoader, SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank } from 'spessasynth_core';
import {
  applyCorrections,
  applyRangeCorrections,
  applyVariationCorrections,
} from './calibration/apply.ts';
import { readCorrections } from './calibration/corrections.ts';
import type { Corrections } from './calibration/corrections.ts';
import { CORRECTIONS_PATH, OUTPUT_SOUND_BANK_PATH, SOURCE_SOUND_BANK_PATH } from './paths.ts';
import {
  buildGsFallbackPreset,
  buildKitPreset,
  buildSfxVoicePreset,
  buildVariationVoicePreset,
} from './remap.ts';
import { XG_KITS } from './xgDrumKits.ts';
import { XG_SFX_VOICES } from './xgSfxVoices.ts';
import { XG_VARIATION_VOICES } from './xgVariationVoices.ts';

export function sourceSha256(source: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(source)).digest('hex');
}

export function buildXgBank(
  source: ArrayBuffer,
  corrections: Corrections,
  warn: (message: string) => void = () => {},
): BasicSoundBank {
  if (corrections.sourceSha256 !== null && corrections.sourceSha256 !== sourceSha256(source)) {
    throw new Error(
      'The source SF3 differs from the one the corrections were fitted to; rerun scripts/xg-soundfont/calibration/calibrate.ts',
    );
  }
  const bank = SoundBankLoader.fromArrayBuffer(source.slice(0));
  const presets = [
    ...XG_KITS.map((kit) => buildKitPreset(bank, kit)),
    ...XG_SFX_VOICES.map((sfx) => buildSfxVoicePreset(bank, sfx)),
  ];
  bank.addPresets(...presets);
  applyCorrections(bank, corrections);
  applyRangeCorrections(bank, corrections.ranges);
  // Added after the corrections so that the variations copy the corrected sources.
  bank.addPresets(
    ...XG_VARIATION_VOICES.map((variation) => buildVariationVoicePreset(bank, variation)),
  );
  // GS and GM fall back from a missing bank MSB n to a preset with LSB n, which would be a variation.
  const missingGsBanks = XG_VARIATION_VOICES.filter(
    ({ bankLSB, program }) =>
      !bank.presets.some((p) => !p.isGMGSDrum && p.bankMSB === bankLSB && p.program === program),
  );
  bank.addPresets(
    ...missingGsBanks.map((variation) =>
      buildGsFallbackPreset(bank, variation.bankLSB, variation.from),
    ),
  );
  for (const message of applyVariationCorrections(
    bank,
    corrections.variations,
    corrections.variationRanges,
  ))
    warn(message);
  bank.flush();
  return bank;
}

export function buildXgSoundBank(
  source: ArrayBuffer,
  corrections: Corrections,
  warn?: (message: string) => void,
): ArrayBuffer {
  // SF2 has no separate bank LSB; an XG variation (MSB 0 / LSB n) would collide with GS bank n.
  return buildXgBank(source, corrections, warn).writeSFE({ software: 'xf-midi-viewer' });
}

export function readSoundBank(path: string): ArrayBuffer {
  const data = readFileSync(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

if (import.meta.main) {
  SpessaLog.setLogLevel(false, true, false);
  const output = buildXgSoundBank(
    readSoundBank(SOURCE_SOUND_BANK_PATH),
    readCorrections(CORRECTIONS_PATH),
    (message) => console.warn(message),
  );
  writeFileSync(OUTPUT_SOUND_BANK_PATH, new Uint8Array(output));
}
