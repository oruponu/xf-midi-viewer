import type { VocalPart } from './types.ts';

export type PartColor = 'base' | 'female' | 'mixed' | 'other';

export function partColorOf(part: VocalPart | null): PartColor {
  switch (part) {
    case null:
    case 'male':
    case 'solo':
      return 'base';
    case 'female':
      return 'female';
    case 'mixed':
      return 'mixed';
    default:
      return 'other';
  }
}
