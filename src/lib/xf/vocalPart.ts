import type { VocalPart } from './types.ts';

export type PartColor = 'base' | 'male' | 'female' | 'other';

export function partColorOf(part: VocalPart | null): PartColor {
  switch (part) {
    case null:
    case 'solo':
    case 'mixed':
      return 'base';
    case 'male':
      return 'male';
    case 'female':
      return 'female';
    default:
      return 'other';
  }
}
