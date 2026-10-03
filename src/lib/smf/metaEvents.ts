import type { KeySignatureChange } from './timing.ts';
import type { SmfFile } from './types.ts';

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface TempoEvent {
  tick: number;
  microsecondsPerQuarter: number;
}

export interface SmfMetaEvents {
  trackName: string | null;
  timeSignatures: TimeSignatureEvent[];
  tempos: TempoEvent[];
  keySignatures: KeySignatureChange[];
}

const TRACK_NAME = 0x03;
const SET_TEMPO = 0x51;
const TIME_SIGNATURE = 0x58;
const KEY_SIGNATURE = 0x59;

export function extractMetaEvents(smf: SmfFile): SmfMetaEvents {
  let trackName: string | null = null;
  const timeSignatures: TimeSignatureEvent[] = [];
  const tempos: TempoEvent[] = [];
  const keySignatures: KeySignatureChange[] = [];

  smf.tracks.forEach((track, trackIndex) => {
    let tick = 0;
    for (const tev of track.events) {
      tick += tev.deltaTime;
      const ev = tev.event;
      if (ev.kind !== 'meta') continue;
      const d = ev.data;
      if (ev.metaType === TRACK_NAME && trackIndex === 0 && trackName === null) {
        trackName = new TextDecoder('iso-8859-1').decode(d);
      } else if (ev.metaType === TIME_SIGNATURE && d.length >= 2) {
        timeSignatures.push({ tick, numerator: d[0]!, denominator: 2 ** d[1]! });
      } else if (ev.metaType === SET_TEMPO && d.length >= 3) {
        tempos.push({ tick, microsecondsPerQuarter: (d[0]! << 16) | (d[1]! << 8) | d[2]! });
      } else if (ev.metaType === KEY_SIGNATURE && d.length >= 2) {
        const sharps = d[0]! > 127 ? d[0]! - 256 : d[0]!;
        keySignatures.push({ tick, signature: { sharps, mode: d[1] === 1 ? 'minor' : 'major' } });
      }
    }
  });

  const byTick = (a: { tick: number }, b: { tick: number }) => a.tick - b.tick;
  return {
    trackName,
    timeSignatures: timeSignatures.sort(byTick),
    tempos: tempos.sort(byTick),
    keySignatures: keySignatures.sort(byTick),
  };
}

export function formatTempo(microsecondsPerQuarter: number): string {
  const bpm = Number((60_000_000 / microsecondsPerQuarter).toFixed(2));
  return String(bpm);
}

export function formatTimeSignature(signature: { numerator: number; denominator: number }): string {
  return `${signature.numerator}/${signature.denominator}`;
}
