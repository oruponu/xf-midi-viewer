import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { BuiltinSynthOutput, waitForClockStart } from './builtinOutput.ts';
import { soundBankGain } from './soundBank.ts';

export type SoundBankLoadResult = 'loaded' | 'fallback';

export interface SoundBankLoadOptions {
  readonly bundled: boolean;
  readonly fallback?: () => Promise<ArrayBuffer>;
}

export interface BuiltinSynthEngine {
  readonly output: BuiltinSynthOutput;
  loadSoundBank(data: ArrayBuffer, options: SoundBankLoadOptions): Promise<SoundBankLoadResult>;
  resumeAudio(): Promise<void>;
  prepare(): Promise<void>;
  destroy(): void;
}

export const BUNDLED_SOUND_BANK_URL = `${import.meta.env.BASE_URL}soundfonts/GeneralUser-GS-XG.sf3`;

const MAIN_SOUND_BANK_ID = 'main';

// Cancels SPESSASYNTH_GAIN_FACTOR (0.6) that spessasynth applies to every voice.
const MASTER_GAIN = 1 / 0.6;

const LIMITER_OPTIONS: DynamicsCompressorOptions = {
  threshold: -6,
  knee: 0,
  ratio: 20,
  attack: 0,
  release: 0.25,
};

// Look-ahead of DynamicsCompressorNode, measured in Chrome; the API does not expose it.
const LIMITER_LATENCY_SECONDS = 0.006;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export function isBuiltinSynthSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof AudioContext === 'function' &&
    typeof AudioWorkletNode === 'function'
  );
}

export function builtinSynthUnsupportedReason(): string {
  return typeof window !== 'undefined' && !window.isSecureContext
    ? '内蔵音源を使うには HTTPS で開いてください'
    : 'このブラウザは内蔵音源に対応していません';
}

export async function fetchBundledSoundBank(): Promise<ArrayBuffer> {
  const response = await fetch(BUNDLED_SOUND_BANK_URL);
  if (!response.ok) throw new Error(`標準の音源を取得できませんでした (HTTP ${response.status})`);
  return response.arrayBuffer();
}

export async function createBuiltinSynthEngine(
  onStall: (stalledAtMs: number) => void,
): Promise<BuiltinSynthEngine> {
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    await context.audioWorklet.addModule(processorUrl);
  } catch (error) {
    void context.close();
    throw error;
  }
  const synth = new WorkletSynthesizer(context);
  synth.setSystemParameter('gain', MASTER_GAIN);
  const gain = context.createGain();
  const limiter = new DynamicsCompressorNode(context, LIMITER_OPTIONS);
  synth.connect(gain);
  gain.connect(limiter);
  limiter.connect(context.destination);
  const output = new BuiltinSynthOutput({
    synth,
    clock: context,
    gain: gain.gain,
    onStall,
    processingLatency: LIMITER_LATENCY_SECONDS,
  });
  const onStateChange = () => output.notifyStateChange();
  context.addEventListener('statechange', onStateChange);

  let pending: Promise<unknown> = Promise.resolve();
  let loadCount = 0;
  let hasSoundBank = false;

  const addSoundBank = (data: ArrayBuffer) =>
    new Promise<void>((resolve, reject) => {
      loadCount += 1;
      const eventId = `xf-midi-viewer-sound-bank-${loadCount}`;
      const settle = (error?: Error) => {
        synth.eventHandler.removeEvent('soundBankError', eventId);
        if (error) reject(error);
        else resolve();
      };
      synth.eventHandler.addEvent('soundBankError', eventId, (error) => settle(error));
      synth.isReady
        .then(() => synth.soundBankManager.addSoundBank(data, MAIN_SOUND_BANK_ID))
        .then(
          () => {
            hasSoundBank = true;
            settle();
          },
          (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
        );
    });

  const setGain = (bundled: boolean) =>
    synth.setSystemParameter('gain', MASTER_GAIN * soundBankGain(bundled));

  const loadSoundBank = (
    data: ArrayBuffer,
    options: SoundBankLoadOptions,
  ): Promise<SoundBankLoadResult> => {
    const run = async (): Promise<SoundBankLoadResult> => {
      try {
        await addSoundBank(data);
      } catch (error) {
        if (!options.fallback) throw error;
        await addSoundBank(await options.fallback());
        setGain(true);
        return 'fallback';
      }
      setGain(options.bundled);
      return 'loaded';
    };
    const result = pending.then(run, run);
    pending = result.catch(() => {});
    return result;
  };

  const resumeAudio = (): Promise<void> => {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = 'playback';
    return context.resume();
  };

  const prepare = async (): Promise<void> => {
    await resumeAudio();
    await pending;
    if (!hasSoundBank) throw new Error('音源が読み込まれていません');
    await waitForClockStart(context);
    output.activate();
  };

  const destroy = () => {
    context.removeEventListener('statechange', onStateChange);
    synth.destroy();
    void context.close();
  };

  return { output, loadSoundBank, resumeAudio, prepare, destroy };
}
