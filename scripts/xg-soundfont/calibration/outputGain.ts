// Usage: bun scripts/xg-soundfont/calibration/outputGain.ts <folder with .mid files>
// Rewrites outputGainDb in corrections.json so the median loudness of the songs stays unchanged.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SpessaLog } from 'spessasynth_core';
import type { BasicSoundBank } from 'spessasynth_core';
import { parseSmf } from '../../../src/lib/smf/parser.ts';
import { buildPlaybackSequence } from '../../../src/lib/smf/playback.ts';
import { buildXgBank, readSoundBank } from '../build.ts';
import { CORRECTIONS_PATH, SOURCE_SOUND_BANK_PATH } from '../paths.ts';
import { NO_CORRECTIONS, readCorrections, writeCorrections } from './corrections.ts';
import { renderMessages, sf3DecoderReady } from './render.ts';

export const SONG_SECONDS = 60;
export const APP_GAIN = 1 / 0.6;
const LIMITER_THRESHOLD_DBFS = -6;

export interface SongMeasure {
  readonly loudness: number;
  readonly peak: number;
}

export function measureSong(bank: BasicSoundBank, bytes: Uint8Array): SongMeasure | null {
  let sequence;
  try {
    sequence = buildPlaybackSequence(parseSmf(bytes));
  } catch {
    return null;
  }
  const end = Math.min(SONG_SECONDS, sequence.durationSeconds);
  if (!(end > 0)) return null;
  const messages = sequence.midiMessages
    .filter((m) => m.seconds <= end)
    .map((m) => ({ seconds: m.seconds, data: m.data }));
  const { energy, peak } = renderMessages(bank, messages, end, { effects: true, gain: APP_GAIN });
  return { loudness: energy.levelDb(0, end), peak };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function outputGainDb(differences: readonly number[]): number {
  if (differences.length === 0) throw new Error('No song could be measured');
  return Math.round(median(differences) * 10) / 10;
}

function midiFiles(folder: string): string[] {
  const seen = new Set<string>();
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      if (!/\.mid$/i.test(name) || seen.has(basename(name).toUpperCase())) return [];
      seen.add(basename(name).toUpperCase());
      return [path];
    });
  return walk(folder);
}

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (!folder) {
    console.error(
      'Usage: bun scripts/xg-soundfont/calibration/outputGain.ts <folder with .mid files>',
    );
    process.exit(2);
  }
  SpessaLog.setLogLevel(false, false, false);
  await sf3DecoderReady();
  const source = readSoundBank(SOURCE_SOUND_BANK_PATH);
  const corrections = readCorrections(CORRECTIONS_PATH);
  const before = buildXgBank(source, NO_CORRECTIONS);
  const after = buildXgBank(source, corrections);
  const differences: number[] = [];
  const peaks: { before: number; after: number }[] = [];
  for (const file of midiFiles(folder)) {
    const bytes = new Uint8Array(readFileSync(file));
    const a = measureSong(before, bytes);
    const b = measureSong(after, bytes);
    if (!a || !b || !Number.isFinite(a.loudness) || !Number.isFinite(b.loudness)) continue;
    differences.push(a.loudness - b.loudness);
    peaks.push({ before: a.peak, after: b.peak });
  }
  let gainDb: number;
  try {
    gainDb = outputGainDb(differences);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const gain = 10 ** (gainDb / 20);
  const over = (threshold: number, pick: (p: { before: number; after: number }) => number) =>
    peaks.filter((p) => 20 * Math.log10(pick(p)) > threshold).length;
  console.log(`songs ${differences.length}, output gain ${gainDb} dB`);
  for (const threshold of [LIMITER_THRESHOLD_DBFS, 0]) {
    console.log(
      `peaks over ${threshold} dBFS: before ${over(threshold, (p) => p.before)}, after ${over(threshold, (p) => p.after * gain)}`,
    );
  }
  writeCorrections(CORRECTIONS_PATH, { ...corrections, outputGainDb: gainDb });
}
