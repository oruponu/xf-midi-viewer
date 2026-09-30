import { BasicSoundBank, SpessaSynthProcessor } from 'spessasynth_core';
import { drumLevels, voiceLevels } from './levels.ts';
import type { DrumLevels, LevelTable, VoiceLevels } from './levels.ts';
import { KWeightedEnergy } from './loudness.ts';
import {
  CALIBRATION_VOICES,
  DRUM_KEYS,
  DRUM_VELOCITIES,
  VOICE_NOTES,
  VOICE_VELOCITIES,
  XG_DRUM_KITS,
  drumTestMidi,
  voiceTestMidi,
} from './testMidi.ts';
import type { TimedMessage, VoiceId } from './testMidi.ts';

export const RENDER_SAMPLE_RATE = 44100;
const BLOCK_SIZE = 128;
const VOICES_PER_RENDER = 20;

// SF3 samples decoded before the decoder is ready stay silent without an error.
let sf3DecoderIsReady = false;

export async function sf3DecoderReady(): Promise<void> {
  await BasicSoundBank.isSF3DecoderReady;
  sf3DecoderIsReady = true;
}

export interface RenderOptions {
  readonly effects: boolean;
  readonly gain: number;
}

export interface RenderResult {
  readonly energy: KWeightedEnergy;
  readonly peak: number;
}

export function renderMessages(
  bank: BasicSoundBank,
  messages: readonly TimedMessage[],
  endSeconds: number,
  options: RenderOptions = { effects: false, gain: 1 },
): RenderResult {
  if (!sf3DecoderIsReady) {
    throw new Error('SF3 decoder is not ready; await sf3DecoderReady() first');
  }
  const synth = new SpessaSynthProcessor(RENDER_SAMPLE_RATE, { effectsEnabled: options.effects });
  synth.setSystemParameter('gain', options.gain);
  synth.soundBankManager.addSoundBank(bank, 'main');
  const energy = new KWeightedEnergy(RENDER_SAMPLE_RATE);
  const left = new Float32Array(BLOCK_SIZE);
  const right = new Float32Array(BLOCK_SIZE);
  const blocks = Math.ceil((endSeconds * RENDER_SAMPLE_RATE) / BLOCK_SIZE);
  let next = 0;
  let peak = 0;
  for (let block = 0; block < blocks; block++) {
    const now = (block * BLOCK_SIZE) / RENDER_SAMPLE_RATE;
    while (next < messages.length && messages[next].seconds <= now) {
      synth.processMessage(messages[next++].data);
    }
    left.fill(0);
    right.fill(0);
    synth.process(left, right);
    for (let i = 0; i < BLOCK_SIZE; i++)
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    energy.push(left, right);
  }
  return { energy, peak };
}

export interface MeasureScope {
  readonly kits?: readonly number[];
  readonly keys?: readonly number[];
  readonly drumVelocities?: readonly number[];
  readonly voices?: readonly VoiceId[];
  readonly notes?: readonly number[];
  readonly voiceVelocities?: readonly number[];
}

export function measureBank(bank: BasicSoundBank, scope: MeasureScope = {}): LevelTable {
  const drums: DrumLevels[] = [];
  for (const kit of scope.kits ?? XG_DRUM_KITS) {
    const midi = drumTestMidi(
      [kit],
      scope.keys ?? DRUM_KEYS,
      scope.drumVelocities ?? DRUM_VELOCITIES,
    );
    drums.push(...drumLevels(renderMessages(bank, midi.messages, midi.endSeconds).energy, midi));
  }
  const voices: VoiceLevels[] = [];
  const ids = scope.voices ?? CALIBRATION_VOICES;
  for (let i = 0; i < ids.length; i += VOICES_PER_RENDER) {
    const midi = voiceTestMidi(
      ids.slice(i, i + VOICES_PER_RENDER),
      scope.notes ?? VOICE_NOTES,
      scope.voiceVelocities ?? VOICE_VELOCITIES,
    );
    voices.push(...voiceLevels(renderMessages(bank, midi.messages, midi.endSeconds).energy, midi));
  }
  return { drums, voices };
}
