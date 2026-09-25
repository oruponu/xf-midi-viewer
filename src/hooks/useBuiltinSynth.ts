import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltinSynthOutput } from '../lib/synth/builtinOutput.ts';
import {
  builtinSynthUnsupportedReason,
  createBuiltinSynthEngine,
  fetchBundledSoundBank,
  isBuiltinSynthSupported,
} from '../lib/synth/engine.ts';
import type { BuiltinSynthEngine, SoundBankLoadResult } from '../lib/synth/engine.ts';

export type BuiltinSynthStatus = 'unsupported' | 'idle' | 'loading' | 'ready' | 'error';

export interface BuiltinSynth {
  status: BuiltinSynthStatus;
  error: string | null;
  output: BuiltinSynthOutput | null;
  prepare: () => Promise<void>;
  retry: () => void;
}

interface BuiltinSynthOptions {
  active: boolean;
  onStall: (stalledAtMs: number) => void;
}

interface LoadedEngine {
  engine: BuiltinSynthEngine;
  result: Promise<SoundBankLoadResult>;
}

export function useBuiltinSynth({ active, onStall }: BuiltinSynthOptions): BuiltinSynth {
  const [supported] = useState(isBuiltinSynthSupported);
  const [engine, setEngine] = useState<BuiltinSynthEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onStallRef = useRef(onStall);

  useEffect(() => {
    onStallRef.current = onStall;
  }, [onStall]);

  useEffect(() => {
    if (!supported || !active || engine) return;
    let cancelled = false;
    void loadEngine((stalledAtMs) => onStallRef.current(stalledAtMs)).then(
      (loaded) => {
        if (cancelled) {
          loaded.engine.destroy();
          return;
        }
        setEngine(loaded.engine);
        setError(null);
        loaded.result.catch((e: unknown) =>
          setError(`音源を読み込めませんでした: ${formatError(e)}`),
        );
      },
      (e: unknown) => {
        if (!cancelled) setError(`内蔵音源を準備できませんでした: ${formatError(e)}`);
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
      prepare,
      retry,
    }),
    [status, supported, error, engine, prepare, retry],
  );
}

async function loadEngine(onStall: (stalledAtMs: number) => void): Promise<LoadedEngine> {
  const engine = await createBuiltinSynthEngine(onStall);
  try {
    const data = await fetchBundledSoundBank();
    return { engine, result: engine.loadSoundBank(data) };
  } catch (error) {
    engine.destroy();
    throw error;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
