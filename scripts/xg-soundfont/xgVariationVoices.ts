import { voice } from './mapping.ts';
import type { XgVariationVoice } from './mapping.ts';

// Variations that XG plays as the base voice but that select a same-numbered GS bank here.
export const XG_VARIATION_VOICES: readonly XgVariationVoice[] = [
  { program: 25, bankLSB: 16, name: 'SteelGt2', from: voice(0, 25) },
];
