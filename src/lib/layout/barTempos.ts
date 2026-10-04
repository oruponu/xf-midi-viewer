import type { PlaybackTempoChange } from '../smf/playback.ts';
import { tickToBarBeat } from '../smf/timing.ts';
import type { SmfTiming } from '../smf/timing.ts';

export function barTempos(
  tempos: readonly PlaybackTempoChange[],
  timing: SmfTiming,
  totalBars: number,
): Map<number, number> {
  const atBarStart = new Map<number, number>();
  for (const change of tempos) {
    const bb = tickToBarBeat(change.tick, timing);
    if (!bb) continue;
    const onBarStart = bb.beat === 1 && bb.tickInBeat === 0;
    const bar = onBarStart ? bb.bar : bb.bar + 1;
    if (bar > totalBars) break;
    atBarStart.set(bar, Math.round(change.bpm));
  }

  const shown = new Map<number, number>();
  let last: number | null = null;
  for (const [bar, bpm] of atBarStart) {
    if (bpm === last) continue;
    shown.set(bar, bpm);
    last = bpm;
  }
  return shown;
}
