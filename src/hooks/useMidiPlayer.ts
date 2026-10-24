import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MidiOutputLike } from '../lib/player/messages.ts';
import {
  BUILTIN_OUTPUT_ID,
  isBuiltinPreferred,
  loadPreferredOutputId,
  resolveOutputSelection,
  savePreferredOutputId,
} from '../lib/player/outputSelection.ts';
import { MidiScheduler } from '../lib/player/scheduler.ts';
import { createSchedulerTimers } from '../lib/player/workerTimers.ts';
import type { KeyShiftChange } from '../lib/smf/fixedKey.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { isBuiltinSynthSupported } from '../lib/synth/support.ts';
import { useBuiltinSynth } from './useBuiltinSynth.ts';
import type { BuiltinSynth } from './useBuiltinSynth.ts';
import { useMediaQuery } from './useMediaQuery.ts';

export interface MidiOutputOption {
  id: string;
  name: string;
  manufacturer: string;
  state: MIDIPortDeviceState;
}

export type MidiAccessState = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

const CLOCK_CHECK_INTERVAL_MS = 100;

export interface PlayerFailure {
  message: string;
  hint?: string;
}

interface PrepareFailure {
  failure: PlayerFailure;
  sequence: PlaybackSequence | null;
  outputId: string;
}

export interface MidiPlayer {
  scheduler: MidiScheduler;
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  midiAccessState: MidiAccessState;
  playerError: string | null;
  failure: PlayerFailure | null;
  midiOutputs: MidiOutputOption[];
  selectedOutputId: string;
  outputReady: boolean;
  isPreparing: boolean;
  builtin: BuiltinSynth;
  requestMidiAccess: () => Promise<void>;
  selectOutput: (id: string) => void;
  play: () => void;
  stop: () => void;
}

export function useMidiPlayer(
  sequence: PlaybackSequence | null,
  keyShiftMap: readonly KeyShiftChange[] | null,
): MidiPlayer {
  const [scheduler] = useState(() => new MidiScheduler({ timers: createSchedulerTimers() }));
  const schedulerState = useSyncExternalStore(scheduler.subscribe, scheduler.getState);
  const [midiAccessState, setMidiAccessState] = useState<MidiAccessState>(() =>
    typeof navigator.requestMIDIAccess === 'function' ? 'idle' : 'unsupported',
  );
  const [accessError, setAccessError] = useState<string | null>(null);
  const [prepareFailure, setPrepareFailure] = useState<PrepareFailure | null>(null);
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputOption[]>([]);
  const [preferredOutputId, setPreferredOutputId] = useState(loadPreferredOutputId);
  const [builtinSupported] = useState(isBuiltinSynthSupported);
  const [isPreparing, setIsPreparing] = useState(false);
  const isTouchPrimary = useMediaQuery('(pointer: coarse)');
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const preparingRef = useRef(false);
  const playRequestRef = useRef(0);
  const builtinSelectedRef = useRef(false);

  const pauseOnStall = useCallback(
    (stalledAtMs: number) => {
      queueMicrotask(() => {
        if (!builtinSelectedRef.current) return;
        playRequestRef.current += 1;
        scheduler.pauseAt(stalledAtMs);
      });
    },
    [scheduler],
  );
  const selectedOutputId = useMemo(
    () =>
      resolveOutputSelection(
        preferredOutputId,
        midiOutputs.map((output) => output.id),
        builtinSupported,
      ),
    [preferredOutputId, midiOutputs, builtinSupported],
  );
  const isBuiltinSelected = selectedOutputId === BUILTIN_OUTPUT_ID;
  const isPlaying = schedulerState.isPlaying;
  const builtin = useBuiltinSynth({
    active: isBuiltinPreferred(preferredOutputId, builtinSupported),
    audioIdle: !(isBuiltinSelected && (isPlaying || isPreparing)),
    onStall: pauseOnStall,
  });
  const builtinOutput = builtin.status === 'ready' ? builtin.output : null;
  const outputReady = isBuiltinSelected
    ? builtinOutput !== null && !builtin.isBusy
    : selectedOutputId !== '';

  const selectOutput = useCallback((id: string) => {
    savePreferredOutputId(id);
    setPreferredOutputId(id);
  }, []);

  const refreshMidiOutputs = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) {
      setMidiOutputs([]);
      return;
    }
    setMidiOutputs(
      Array.from(access.outputs.values())
        .filter((output) => output.state === 'connected')
        .map((output) => ({
          id: output.id,
          name: output.name ?? 'MIDI 出力',
          manufacturer: output.manufacturer ?? '',
          state: output.state,
        })),
    );
  }, []);

  const requestMidiAccess = useCallback(async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      setMidiAccessState('unsupported');
      setAccessError('このブラウザはWeb MIDI APIに対応していません。');
      return;
    }

    setMidiAccessState('requesting');
    setAccessError(null);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      midiAccessRef.current = access;
      setMidiAccessState('ready');
      refreshMidiOutputs();
      access.onstatechange = refreshMidiOutputs;
    } catch (err) {
      setMidiAccessState('denied');
      setAccessError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshMidiOutputs]);

  useEffect(() => {
    scheduler.setSequence(sequence);
  }, [scheduler, sequence]);

  useEffect(() => {
    scheduler.setKeyShiftMap(keyShiftMap);
  }, [scheduler, keyShiftMap]);

  useEffect(() => {
    let output: MidiOutputLike | null = null;
    if (isBuiltinSelected) output = builtinOutput;
    else if (selectedOutputId)
      output = midiAccessRef.current?.outputs.get(selectedOutputId) ?? null;
    scheduler.setOutput(output);
  }, [scheduler, isBuiltinSelected, builtinOutput, selectedOutputId, midiOutputs]);

  useEffect(() => {
    builtinSelectedRef.current = isBuiltinSelected;
  }, [isBuiltinSelected]);

  useEffect(() => {
    if (!isBuiltinSelected || !builtinOutput || !isPlaying) return;
    const handle = window.setInterval(() => builtinOutput.checkClock(), CLOCK_CHECK_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [isBuiltinSelected, builtinOutput, isPlaying]);

  useEffect(() => {
    playRequestRef.current += 1;
  }, [sequence, selectedOutputId]);

  useEffect(() => {
    if (!isBuiltinSelected || !isTouchPrimary) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      playRequestRef.current += 1;
      scheduler.pause();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [scheduler, isBuiltinSelected, isTouchPrimary]);

  useEffect(() => {
    return () => {
      scheduler.dispose();
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
    };
  }, [scheduler]);

  useEffect(() => {
    let cancelled = false;
    if (midiAccessState !== 'idle') return;

    void queryMidiPermission().then((state) => {
      if (cancelled) return;
      if (state === 'granted') {
        void requestMidiAccess();
      } else if (state === 'denied') {
        setMidiAccessState('denied');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [midiAccessState, requestMidiAccess]);

  const { prepare, isBusy: isSoundBankBusy } = builtin;
  const play = useCallback(() => {
    if (!isBuiltinSelected) {
      scheduler.play();
      return;
    }
    if (preparingRef.current || isSoundBankBusy) return;
    preparingRef.current = true;
    playRequestRef.current += 1;
    const request = playRequestRef.current;
    setIsPreparing(true);
    setPrepareFailure(null);
    prepare()
      .then(
        () => {
          if (request === playRequestRef.current) scheduler.play();
        },
        (error: unknown) => {
          if (request === playRequestRef.current) {
            setPrepareFailure({
              failure: { message: `音声を開始できませんでした: ${formatError(error)}` },
              sequence,
              outputId: selectedOutputId,
            });
          }
        },
      )
      .finally(() => {
        preparingRef.current = false;
        setIsPreparing(false);
      });
  }, [scheduler, isBuiltinSelected, prepare, isSoundBankBusy, sequence, selectedOutputId]);

  const stop = useCallback(() => {
    playRequestRef.current += 1;
    scheduler.stop();
  }, [scheduler]);

  const isPrepareFailureCurrent =
    prepareFailure?.sequence === sequence && prepareFailure.outputId === selectedOutputId;
  if (prepareFailure && !isPrepareFailureCurrent) setPrepareFailure(null);
  const activePrepareFailure = isPrepareFailureCurrent ? prepareFailure.failure : null;
  const sendError = schedulerState.sendError;
  const sendFailure = useMemo(
    () =>
      sendError ? { message: `音の送信に失敗しました: ${formatError(sendError.error)}` } : null,
    [sendError],
  );
  const builtinLoadError = isBuiltinSelected && builtin.status === 'error' ? builtin.error : null;
  const builtinLoadFailure = useMemo(
    () =>
      builtinLoadError ? { message: builtinLoadError, hint: '設定から再読み込みできます。' } : null,
    [builtinLoadError],
  );
  const builtinProcessorFailure = isBuiltinSelected ? builtin.processorFailure : null;
  const playerError = accessError ?? (activePrepareFailure ?? sendFailure)?.message ?? null;
  const failure =
    activePrepareFailure ?? sendFailure ?? builtinProcessorFailure ?? builtinLoadFailure;

  return useMemo(
    () => ({
      scheduler,
      isPlaying: schedulerState.isPlaying,
      playbackRate: schedulerState.playbackRate,
      keyShift: schedulerState.keyShift,
      midiAccessState,
      playerError,
      failure,
      midiOutputs,
      selectedOutputId,
      outputReady,
      isPreparing,
      builtin,
      requestMidiAccess,
      selectOutput,
      play,
      stop,
    }),
    [
      scheduler,
      schedulerState,
      midiAccessState,
      playerError,
      failure,
      midiOutputs,
      selectedOutputId,
      outputReady,
      isPreparing,
      builtin,
      requestMidiAccess,
      selectOutput,
      play,
      stop,
    ],
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type MidiPermissionDescriptor = PermissionDescriptor & {
  name: 'midi';
  sysex?: boolean;
};

async function queryMidiPermission(): Promise<PermissionState | null> {
  if (!navigator.permissions) return null;
  try {
    const status = await navigator.permissions.query({
      name: 'midi',
      sysex: true,
    } as MidiPermissionDescriptor);
    return status.state;
  } catch {
    return null;
  }
}
