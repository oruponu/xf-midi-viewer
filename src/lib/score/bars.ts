import { keyShiftAt } from '../smf/fixedKey.ts';
import type { KeyShiftChange } from '../smf/fixedKey.ts';
import { shiftKeySignature } from '../smf/timing.ts';
import type { KeySignatureChange, SmfTiming, TimeSignatureChange } from '../smf/timing.ts';

export interface ScoreBar {
  startTick: number;
  ticks: number;
  numerator: number;
  denominator: number;
  timeChanged: boolean;
  keySharps: number;
  keyChanged: boolean;
  sectionStart: boolean;
}

const MAX_BARS = 2000;

const COMMON_TIME: TimeSignatureChange = {
  tick: 0,
  signature: { numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondNotesPerQuarter: 8 },
};

// A time signature change takes effect at the first bar line at or after it.
export function buildBars(timing: SmfTiming, durationTicks: number, ppq: number): ScoreBar[] {
  const sigs = timing.timeSignatures.length > 0 ? timing.timeSignatures : [COMMON_TIME];
  const gridTicks = ppq / 4;
  const bars: ScoreBar[] = [];
  let tick = 0;
  let si = 0;
  let prev = '';
  while (tick < durationTicks && bars.length < MAX_BARS) {
    while (si + 1 < sigs.length && sigs[si + 1]!.tick <= tick) si += 1;
    const { numerator, denominator } = sigs[si]!.signature;
    const exact = (ppq * 4 * numerator) / denominator;
    const ticks = Math.max(gridTicks, Math.round(exact / gridTicks) * gridTicks);
    const id = `${numerator}/${denominator}`;
    bars.push({
      startTick: tick,
      ticks,
      numerator,
      denominator,
      timeChanged: id !== prev,
      keySharps: 0,
      keyChanged: false,
      sectionStart: false,
    });
    prev = id;
    tick += ticks;
  }
  return bars;
}

// A key change in the first half of a bar applies from that bar, otherwise from the next one.
export function assignKeys(
  bars: ScoreBar[],
  timing: SmfTiming,
  keyShifts: readonly KeyShiftChange[],
): void {
  const keys = timing.keySignatures;
  let ki = -1;
  let prev = 0;
  bars.forEach((bar, bi) => {
    while (ki + 1 < keys.length && keys[ki + 1]!.tick <= bar.startTick + bar.ticks / 2) ki += 1;
    const key: KeySignatureChange = keys[ki] ?? {
      tick: bar.startTick,
      signature: { sharps: 0, mode: 'major' },
    };
    const sharps = shiftKeySignature(key.signature, keyShiftAt(key.tick, keyShifts)).sharps;
    bar.keySharps = sharps;
    bar.keyChanged = bi > 0 && sharps !== prev;
    prev = sharps;
  });
}

export function markSections(bars: ScoreBar[], sectionTicks: readonly number[]): void {
  for (const tick of sectionTicks) {
    let bi = bars.length - 1;
    while (bi > 0 && bars[bi]!.startTick > tick) bi -= 1;
    if (bi > 0) bars[bi]!.sectionStart = true;
  }
}
