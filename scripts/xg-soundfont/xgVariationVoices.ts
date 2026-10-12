import { XG_NORMAL_VOICES } from '../../src/lib/xg/voiceList.ts';
import { voice } from './mapping.ts';
import type { XgVariationVoice } from './mapping.ts';

type VoiceEntry = readonly [program: number, bankLSB: number, name: string];
type VariationId = readonly [program: number, bankLSB: number];

// Their LSB selects a same-numbered GS bank, which sounds closer to the reference than the base voice.
export const KEPT_IN_GS_BANKS: readonly VariationId[] = [
  [81, 8], // ThickSaw
  [48, 8], // SlowStr
  [80, 8], // LMSquare
];

export function variationVoices(
  voices: readonly VoiceEntry[],
  kept: readonly VariationId[],
): XgVariationVoice[] {
  const isKept = (program: number, bankLSB: number) =>
    kept.some(([p, l]) => p === program && l === bankLSB);
  for (const [program, bankLSB] of kept) {
    if (!voices.some(([p, l]) => p === program && l === bankLSB)) {
      throw new Error(`Variation LSB ${bankLSB} / PC ${program} to keep is not an XG voice`);
    }
  }
  return voices
    .filter(([program, bankLSB]) => bankLSB !== 0 && !isKept(program, bankLSB))
    .map(([program, bankLSB, name]) => ({ program, bankLSB, name, from: voice(0, program) }));
}

export const XG_VARIATION_VOICES: readonly XgVariationVoice[] = variationVoices(
  XG_NORMAL_VOICES,
  KEPT_IN_GS_BANKS,
);
