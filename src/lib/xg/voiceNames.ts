import { XG_NORMAL_VOICES, XG_SFX_VOICES } from './voiceList.ts';

export interface VoiceSelection {
  bankMSB: number;
  bankLSB: number;
  program: number;
  isDrum: boolean;
}

const NORMAL_BANK_MSB = 0;
const SFX_VOICE_BANK_MSB = 64;
const SFX_KIT_BANK_MSB = 126;
const DEFAULT_KIT = 'Standard Kit';

const DRUM_KITS: ReadonlyMap<number, string> = new Map([
  [0, 'Standard Kit'],
  [1, 'Standard2 Kit'],
  [8, 'Room Kit'],
  [16, 'Rock Kit'],
  [24, 'Electro Kit'],
  [25, 'Analog Kit'],
  [32, 'Jazz Kit'],
  [40, 'Brush Kit'],
  [48, 'Classic Kit'],
]);

const SFX_KITS: ReadonlyMap<number, string> = new Map([
  [0, 'SFX 1'],
  [1, 'SFX 2'],
]);

const normalVoices: ReadonlyMap<number, string> = new Map(
  XG_NORMAL_VOICES.map(([program, bankLSB, name]) => [normalKey(program, bankLSB), name]),
);

const sfxVoices: ReadonlyMap<number, string> = new Map(XG_SFX_VOICES);

export function isXgDrumKit(program: number): boolean {
  return DRUM_KITS.has(program);
}

export function voiceName(voice: VoiceSelection): string | null {
  const { bankMSB, bankLSB, program } = voice;
  if (voice.isDrum) {
    if (bankMSB === SFX_KIT_BANK_MSB) return SFX_KITS.get(program) ?? null;
    return DRUM_KITS.get(program) ?? DEFAULT_KIT;
  }
  if (bankMSB === SFX_VOICE_BANK_MSB) return sfxVoices.get(program) ?? null;
  if (bankMSB !== NORMAL_BANK_MSB) return null;
  return (
    normalVoices.get(normalKey(program, bankLSB)) ?? normalVoices.get(normalKey(program, 0)) ?? null
  );
}

function normalKey(program: number, bankLSB: number): number {
  return program * 128 + bankLSB;
}
