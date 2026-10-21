import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltinSynthOutput } from '../lib/synth/builtinOutput.ts';
import {
  builtinSynthUnsupportedReason,
  createBuiltinSynthEngine,
  fetchBundledSoundBank,
  isBuiltinSynthSupported,
} from '../lib/synth/engine.ts';
import type {
  BuiltinSynthEngine,
  BuiltinSynthEngineCallbacks,
  SoundBankLoadResult,
} from '../lib/synth/engine.ts';
import { processorFailureNotice } from '../lib/synth/processorFailure.ts';
import type { ProcessorFailureNotice } from '../lib/synth/processorFailure.ts';
import {
  BUNDLED_SOUND_BANK,
  DELETE_FAILURE_MESSAGE,
  nextSoundBankToLoad,
  SAVED_LOAD_FAILURE_MESSAGE,
  saveFailureMessage,
  savedAfterAttempt,
} from '../lib/synth/soundBank.ts';
import type { SoundBankEntry } from '../lib/synth/soundBank.ts';
import {
  deleteSavedSoundBank,
  loadSavedSoundBank,
  saveSoundBank,
} from '../lib/synth/soundBankStore.ts';

export type BuiltinSynthStatus = 'unsupported' | 'idle' | 'loading' | 'ready' | 'error';

export interface BuiltinSynth {
  status: BuiltinSynthStatus;
  error: string | null;
  output: BuiltinSynthOutput | null;
  soundBank: SoundBankEntry | null;
  nextSoundBank: SoundBankEntry;
  notice: string | null;
  processorFailure: ProcessorFailureNotice | null;
  isBusy: boolean;
  prepare: () => Promise<void>;
  retry: () => void;
  unlockAudio: () => void;
  loadUserSoundBank: (file: File) => Promise<void>;
  resetSoundBank: () => Promise<void>;
}

interface BuiltinSynthOptions {
  active: boolean;
  onStall: (stalledAtMs: number) => void;
}

interface InitialLoadResult {
  outcome: SoundBankLoadResult;
  deleted: boolean;
}

interface LoadedEngine {
  engine: BuiltinSynthEngine;
  soundBank: SoundBankEntry;
  saved: SoundBankEntry | null;
  result: Promise<InitialLoadResult>;
}

export function useBuiltinSynth({ active, onStall }: BuiltinSynthOptions): BuiltinSynth {
  const [supported] = useState(isBuiltinSynthSupported);
  const [engine, setEngine] = useState<BuiltinSynthEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [soundBank, setSoundBank] = useState<SoundBankEntry | null>(null);
  const [savedSoundBank, setSavedSoundBank] = useState<SoundBankEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [processorFailure, setProcessorFailure] = useState<ProcessorFailureNotice | null>(null);
  const onStallRef = useRef(onStall);
  const soundBankRef = useRef(soundBank);

  useEffect(() => {
    onStallRef.current = onStall;
  }, [onStall]);

  useEffect(() => {
    soundBankRef.current = soundBank;
  }, [soundBank]);

  useEffect(() => {
    if (!supported || !active || engine) return;
    let cancelled = false;
    let loadedEngine: BuiltinSynthEngine | null = null;
    void loadEngine({
      onStall: (stalledAtMs) => onStallRef.current(stalledAtMs),
      onProcessorError: (reason) => {
        const crashed = loadedEngine;
        if (!crashed) return;
        setProcessorFailure(
          processorFailureNotice(reason, soundBankRef.current ?? BUNDLED_SOUND_BANK),
        );
        setEngine((current) => (current === crashed ? null : current));
      },
    }).then(
      (loaded) => {
        if (cancelled) {
          loaded.engine.destroy();
          return;
        }
        loadedEngine = loaded.engine;
        setEngine(loaded.engine);
        setError(null);
        setProcessorFailure(null);
        setSoundBank(loaded.soundBank);
        setSavedSoundBank(loaded.saved);
        loaded.result.then(
          ({ outcome, deleted }) => {
            if (outcome !== 'fallback') return;
            setSoundBank(BUNDLED_SOUND_BANK);
            if (deleted) {
              setSavedSoundBank(null);
              setNotice(SAVED_LOAD_FAILURE_MESSAGE);
            } else {
              setNotice(`${SAVED_LOAD_FAILURE_MESSAGE}。${DELETE_FAILURE_MESSAGE}`);
            }
          },
          (e: unknown) => setError(`音源を読み込めませんでした: ${formatError(e)}`),
        );
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(`内蔵音源を準備できませんでした: ${formatError(e)}`);
        setProcessorFailure(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [supported, active, engine, attempt]);

  useEffect(() => () => engine?.destroy(), [engine]);

  const prepare = useCallback(
    () => (engine ? engine.prepare() : Promise.reject(new Error('内蔵音源の準備ができていません'))),
    [engine],
  );

  const retry = useCallback(() => {
    setError(null);
    setEngine(null);
    setAttempt((n) => n + 1);
  }, []);

  const loadUserSoundBank = useCallback(
    async (file: File) => {
      if (!engine) return;
      setIsBusy(true);
      setNotice(null);
      try {
        const data = await file.arrayBuffer();
        try {
          await engine.loadSoundBank(data.slice(0), { bundled: false });
        } catch (e) {
          setNotice(`${file.name} を読み込めませんでした: ${formatError(e)}`);
          return;
        }
        const entry: SoundBankEntry = { name: file.name, bundled: false };
        setSoundBank(entry);
        let saved = true;
        try {
          await saveSoundBank({ name: file.name, data });
        } catch {
          saved = false;
        }
        const nextSaved = savedAfterAttempt(savedSoundBank, entry, saved);
        setSavedSoundBank(nextSaved);
        if (!saved) setNotice(saveFailureMessage(nextSoundBankToLoad(nextSaved)));
      } finally {
        setIsBusy(false);
      }
    },
    [engine, savedSoundBank],
  );

  const unlockAudio = useCallback(() => {
    void engine?.resumeAudio().catch(() => {});
  }, [engine]);

  const resetSoundBank = useCallback(async () => {
    if (!engine) return;
    void engine.resumeAudio().catch(() => {});
    setIsBusy(true);
    setNotice(null);
    const messages: string[] = [];
    try {
      try {
        await deleteSavedSoundBank();
        setSavedSoundBank(null);
      } catch {
        messages.push(DELETE_FAILURE_MESSAGE);
      }
      try {
        await engine.loadSoundBank(await fetchBundledSoundBank(), { bundled: true });
        setSoundBank(BUNDLED_SOUND_BANK);
      } catch (e) {
        messages.push(`標準の音源を読み込めませんでした: ${formatError(e)}`);
      }
      setNotice(messages.length > 0 ? messages.join(' ') : null);
    } finally {
      setIsBusy(false);
    }
  }, [engine]);

  const status: BuiltinSynthStatus = !supported
    ? 'unsupported'
    : error !== null
      ? 'error'
      : engine
        ? 'ready'
        : active
          ? 'loading'
          : 'idle';

  return useMemo(
    () => ({
      status,
      error: supported ? error : builtinSynthUnsupportedReason(),
      output: engine?.output ?? null,
      soundBank,
      nextSoundBank: nextSoundBankToLoad(savedSoundBank),
      notice,
      processorFailure,
      isBusy,
      prepare,
      retry,
      unlockAudio,
      loadUserSoundBank,
      resetSoundBank,
    }),
    [
      status,
      supported,
      error,
      engine,
      soundBank,
      savedSoundBank,
      notice,
      processorFailure,
      isBusy,
      prepare,
      retry,
      unlockAudio,
      loadUserSoundBank,
      resetSoundBank,
    ],
  );
}

async function loadEngine(callbacks: BuiltinSynthEngineCallbacks): Promise<LoadedEngine> {
  const engine = await createBuiltinSynthEngine(callbacks);
  try {
    const saved = await loadSavedSoundBank().catch(() => null);
    if (saved) {
      const entry: SoundBankEntry = { name: saved.name, bundled: false };
      const result = engine
        .loadSoundBank(saved.data, { bundled: false, fallback: fetchBundledSoundBank })
        .then(async (outcome): Promise<InitialLoadResult> => {
          if (outcome !== 'fallback') return { outcome, deleted: false };
          const deleted = await deleteSavedSoundBank().then(
            () => true,
            () => false,
          );
          return { outcome, deleted };
        });
      return { engine, soundBank: entry, saved: entry, result };
    }
    const result = engine
      .loadSoundBank(await fetchBundledSoundBank(), { bundled: true })
      .then((outcome): InitialLoadResult => ({ outcome, deleted: false }));
    return { engine, soundBank: BUNDLED_SOUND_BANK, saved: null, result };
  } catch (error) {
    engine.destroy();
    throw error;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
