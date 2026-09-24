import type { LyricToken } from './lyrics.ts';
import type { RehearsalMessage } from './types.ts';

export function computeKaraokeSectionBreaks(
  tokens: readonly LyricToken[],
  rehearsals: readonly RehearsalMessage[],
): { replaceWithDivider: Set<number>; dividerBefore: Set<number> } {
  const replaceWithDivider = new Set<number>();
  const dividerBefore = new Set<number>();
  if (rehearsals.length === 0) {
    return { replaceWithDivider, dividerBefore };
  }

  let consumedBreakIdx = -1;

  for (let rIdx = 0; rIdx < rehearsals.length; rIdx += 1) {
    const r = rehearsals[rIdx]!;
    const nextRehearsalTick = rehearsals[rIdx + 1]?.tick ?? Infinity;

    let backIdx = -1;
    let fwdIdx = -1;
    for (let i = consumedBreakIdx + 1; i < tokens.length; i += 1) {
      const tok = tokens[i]!;
      if (tok.tick >= nextRehearsalTick) break;
      if (tok.kind !== 'lineBreak' && tok.kind !== 'pageBreak') continue;
      if (tok.tick <= r.tick) {
        backIdx = i;
      } else {
        fwdIdx = i;
        break;
      }
    }

    if (fwdIdx !== -1 && nextRehearsalTick !== Infinity) {
      const fwdTick = tokens[fwdIdx]!.tick;
      if (fwdTick - r.tick > nextRehearsalTick - fwdTick) {
        fwdIdx = -1;
      }
    }

    let chosenIdx = -1;
    if (backIdx !== -1 && fwdIdx !== -1) {
      let backChunk = 0;
      let fwdChunk = 0;
      for (let i = backIdx + 1; i < fwdIdx; i += 1) {
        const tok = tokens[i]!;
        if (tok.kind !== 'syllable') continue;
        if (tok.tick < r.tick) backChunk += 1;
        else fwdChunk += 1;
      }
      chosenIdx = backChunk <= fwdChunk ? backIdx : fwdIdx;
    } else if (backIdx !== -1) {
      chosenIdx = backIdx;
    } else if (fwdIdx !== -1) {
      chosenIdx = fwdIdx;
    }

    if (chosenIdx !== -1) {
      replaceWithDivider.add(chosenIdx);
      consumedBreakIdx = chosenIdx;
    } else {
      const fallbackIdx = tokens.findIndex((t) => t.tick >= r.tick);
      if (fallbackIdx > 0) dividerBefore.add(fallbackIdx);
    }
  }

  return { replaceWithDivider, dividerBefore };
}
