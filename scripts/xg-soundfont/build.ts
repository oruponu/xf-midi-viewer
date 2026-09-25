import { readFileSync, writeFileSync } from 'node:fs';
import { SoundBankLoader, SpessaLog } from 'spessasynth_core';
import { OUTPUT_SOUND_BANK_PATH, SOURCE_SOUND_BANK_PATH } from './paths.ts';
import { buildKitPreset, buildSfxVoicePreset } from './remap.ts';
import { XG_KITS } from './xgDrumKits.ts';
import { XG_SFX_VOICES } from './xgSfxVoices.ts';

export function buildXgSoundBank(source: ArrayBuffer): ArrayBuffer {
  const bank = SoundBankLoader.fromArrayBuffer(source);
  const presets = [
    ...XG_KITS.map((kit) => buildKitPreset(bank, kit)),
    ...XG_SFX_VOICES.map((sfx) => buildSfxVoicePreset(bank, sfx)),
  ];
  bank.addPresets(...presets);
  bank.flush();
  return bank.writeSF2({ software: 'xf-midi-viewer' });
}

export function readSoundBank(path: string): ArrayBuffer {
  const data = readFileSync(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

if (import.meta.main) {
  SpessaLog.setLogLevel(false, true, false);
  const output = buildXgSoundBank(readSoundBank(SOURCE_SOUND_BANK_PATH));
  writeFileSync(OUTPUT_SOUND_BANK_PATH, new Uint8Array(output));
}
