import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';

export interface MidiOutputOption {
  id: string;
  name: string;
  manufacturer: string;
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
}

export type MidiAccessState = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied';

export interface MidiPlayer {
  scheduler: MidiScheduler;
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  midiAccessState: MidiAccessState;
  midiError: string | null;
  midiOutputs: MidiOutputOption[];
  selectedMidiOutputId: string;
  requestMidiAccess: () => Promise<void>;
  selectMidiOutput: (id: string) => void;
}

export function useMidiPlayer(sequence: PlaybackSequence | null): MidiPlayer {
  const [scheduler] = useState(() => new MidiScheduler());
  const schedulerState = useSyncExternalStore(scheduler.subscribe, scheduler.getState);
  const [midiAccessState, setMidiAccessState] = useState<MidiAccessState>(() =>
    typeof navigator.requestMIDIAccess === 'function' ? 'idle' : 'unsupported',
  );
  const [accessError, setAccessError] = useState<string | null>(null);
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputOption[]>([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState('');
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const selectedMidiOutputIdRef = useRef('');

  const selectMidiOutput = useCallback(
    (id: string) => {
      selectedMidiOutputIdRef.current = id;
      scheduler.setOutput(midiAccessRef.current?.outputs.get(id) ?? null);
      setSelectedMidiOutputId(id);
    },
    [scheduler],
  );

  const refreshMidiOutputs = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) {
      setMidiOutputs([]);
      selectMidiOutput('');
      return;
    }

    const outputs = Array.from(access.outputs.values())
      .filter((output) => output.state === 'connected')
      .map((output) => ({
        id: output.id,
        name: output.name ?? 'MIDI Output',
        manufacturer: output.manufacturer ?? '',
        state: output.state,
        connection: output.connection,
      }));
    setMidiOutputs(outputs);

    const selectedStillExists = outputs.some(
      (output) => output.id === selectedMidiOutputIdRef.current,
    );
    if (!selectedStillExists) selectMidiOutput(outputs[0]?.id ?? '');
  }, [selectMidiOutput]);

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

  const sendError = schedulerState.sendError;
  const midiError =
    accessError ??
    (sendError ? `MIDI送信に失敗しました: ${formatMidiSendError(sendError.error)}` : null);

  return useMemo(
    () => ({
      scheduler,
      isPlaying: schedulerState.isPlaying,
      playbackRate: schedulerState.playbackRate,
      keyShift: schedulerState.keyShift,
      midiAccessState,
      midiError,
      midiOutputs,
      selectedMidiOutputId,
      requestMidiAccess,
      selectMidiOutput,
    }),
    [
      scheduler,
      schedulerState,
      midiAccessState,
      midiError,
      midiOutputs,
      selectedMidiOutputId,
      requestMidiAccess,
      selectMidiOutput,
    ],
  );
}

function formatMidiSendError(error: unknown): string {
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
