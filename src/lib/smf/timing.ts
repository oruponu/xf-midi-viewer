import type { SmfFile } from './types.ts';

export interface TimeSignature {
  numerator: number;
  denominator: number;
  clocksPerClick: number;
  thirtySecondNotesPerQuarter: number;
}

export interface TimeSignatureChange {
  tick: number;
  signature: TimeSignature;
}

export interface SmfTiming {
  ppq: number;
  timeSignatures: TimeSignatureChange[];
}

export interface BarBeat {
  bar: number;
  beat: number;
  tickInBeat: number;
}

const DEFAULT_SIGNATURE: TimeSignature = {
  numerator: 4,
  denominator: 4,
  clocksPerClick: 24,
  thirtySecondNotesPerQuarter: 8,
};

export function extractTiming(smf: SmfFile): SmfTiming {
  const ppq =
    smf.header.division.kind === 'tpqn'
      ? smf.header.division.ticksPerQuarter
      : 0;

  const changes: TimeSignatureChange[] = [];
  for (const track of smf.tracks) {
    let tick = 0;
    for (const tev of track.events) {
      tick += tev.deltaTime;
      const ev = tev.event;
      if (ev.kind === 'meta' && ev.metaType === 0x58 && ev.data.length >= 4) {
        changes.push({
          tick,
          signature: {
            numerator: ev.data[0]!,
            denominator: 1 << ev.data[1]!,
            clocksPerClick: ev.data[2]!,
            thirtySecondNotesPerQuarter: ev.data[3]!,
          },
        });
      }
    }
  }

  changes.sort((a, b) => a.tick - b.tick);

  if (changes.length === 0 || changes[0]!.tick > 0) {
    changes.unshift({ tick: 0, signature: DEFAULT_SIGNATURE });
  }

  return { ppq, timeSignatures: changes };
}

function ticksPerBeat(ppq: number, sig: TimeSignature): number {
  return Math.max(1, Math.round((ppq * 4) / sig.denominator));
}

export function tickToBarBeat(tick: number, timing: SmfTiming): BarBeat | null {
  if (timing.ppq <= 0 || timing.timeSignatures.length === 0 || tick < 0) {
    return null;
  }

  const sigs = timing.timeSignatures;

  let idx = 0;
  for (let i = 0; i < sigs.length; i++) {
    if (sigs[i]!.tick <= tick) idx = i;
    else break;
  }

  let cumBar = 0;
  for (let i = 0; i < idx; i++) {
    const cur = sigs[i]!;
    const next = sigs[i + 1]!;
    const tpb =
      ticksPerBeat(timing.ppq, cur.signature) * cur.signature.numerator;
    cumBar += Math.floor((next.tick - cur.tick) / tpb);
  }

  const seg = sigs[idx]!;
  const relTick = tick - seg.tick;
  const tpBeat = ticksPerBeat(timing.ppq, seg.signature);
  const tpBar = tpBeat * seg.signature.numerator;
  const barInSeg = Math.floor(relTick / tpBar);
  const ticksInBar = relTick % tpBar;
  const beatInBar = Math.floor(ticksInBar / tpBeat);
  const tickInBeat = ticksInBar % tpBeat;

  return {
    bar: cumBar + barInSeg + 1,
    beat: beatInBar + 1,
    tickInBeat,
  };
}

export function formatBarBeat(bb: BarBeat): string {
  return `${bb.bar}:${bb.beat}:${bb.tickInBeat}`;
}

export function formatTickAsBarBeat(tick: number, timing: SmfTiming): string {
  const bb = tickToBarBeat(tick, timing);
  return bb ? formatBarBeat(bb) : String(tick);
}
