import type { KWeightedEnergy } from './loudness.ts';
import type { DrumProbe, TestMidi, VoiceProbe } from './testMidi.ts';
import { VOICE_NOTE_SECONDS } from './testMidi.ts';

export type Level = number | null;

export interface DrumLevels {
  readonly kit: number;
  readonly key: number;
  readonly levels: Readonly<Record<string, Level>>;
}

export interface VoiceLevels {
  readonly bankMSB: number;
  readonly program: number;
  readonly levels: Readonly<Record<string, Level>>;
}

export interface LevelTable {
  readonly drums: readonly DrumLevels[];
  readonly voices: readonly VoiceLevels[];
}

export const SILENT_DB = -80;
const MARKER_SEARCH_SECONDS = 1.2;
const ONSET_RELATIVE_DB = -20;
const HIT_BEFORE_SECONDS = 0.02;
const HIT_AFTER_SECONDS = 0.3;
const HIT_WINDOW_SECONDS = 0.05;

export const drumLevelKey = (velocity: number): string => String(velocity);
export const voiceLevelKey = (note: number, velocity: number): string => `${note}/${velocity}`;

export function markerShift(energy: KWeightedEnergy, midi: TestMidi<unknown>): number {
  const onset = energy.onsetSeconds(
    0,
    midi.markerSeconds + MARKER_SEARCH_SECONDS,
    ONSET_RELATIVE_DB,
  );
  if (onset === null) throw new Error('Marker hit not found');
  return onset - midi.markerSeconds;
}

function toLevel(db: number): Level {
  return Number.isFinite(db) ? Math.round(db * 100) / 100 : null;
}

export function drumLevels(energy: KWeightedEnergy, midi: TestMidi<DrumProbe>): DrumLevels[] {
  const shift = markerShift(energy, midi);
  const table = new Map<string, { kit: number; key: number; levels: Record<string, Level> }>();
  for (const { probe, seconds } of midi.probes) {
    const at = seconds + shift;
    const db = energy.peakWindowDb(
      at - HIT_BEFORE_SECONDS,
      at + HIT_AFTER_SECONDS,
      HIT_WINDOW_SECONDS,
    );
    const id = `${probe.kit}/${probe.key}`;
    let entry = table.get(id);
    if (!entry) {
      entry = { kit: probe.kit, key: probe.key, levels: {} };
      table.set(id, entry);
    }
    entry.levels[drumLevelKey(probe.velocity)] = toLevel(db);
  }
  return [...table.values()];
}

export function voiceLevels(energy: KWeightedEnergy, midi: TestMidi<VoiceProbe>): VoiceLevels[] {
  const shift = markerShift(energy, midi);
  const table = new Map<
    string,
    { bankMSB: number; program: number; levels: Record<string, Level> }
  >();
  for (const { probe, seconds } of midi.probes) {
    const db = energy.levelDb(seconds + shift, VOICE_NOTE_SECONDS);
    const id = `${probe.bankMSB}/${probe.program}`;
    let entry = table.get(id);
    if (!entry) {
      entry = { bankMSB: probe.bankMSB, program: probe.program, levels: {} };
      table.set(id, entry);
    }
    entry.levels[voiceLevelKey(probe.note, probe.velocity)] = toLevel(db);
  }
  return [...table.values()];
}
