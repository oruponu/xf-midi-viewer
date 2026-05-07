import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PlaybackMidiMessage,
  PlaybackSequence,
} from '../lib/smf/playback.ts';

interface MidiOutputOption {
  id: string;
  name: string;
  manufacturer: string;
  state: MIDIPortDeviceState;
  connection: MIDIPortConnectionState;
}

type MidiAccessState =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied';

interface MidiPlayerState {
  isPlaying: boolean;
  positionSeconds: number;
  getPositionSeconds: () => number;
  midiAccessState: MidiAccessState;
  midiError: string | null;
  midiOutputs: MidiOutputOption[];
  selectedMidiOutputId: string;
  requestMidiAccess: () => Promise<void>;
  selectMidiOutput: (id: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
}

const LOOKAHEAD_SECONDS = 0.05;
const SCHEDULER_MS = 10;
const UI_UPDATE_INTERVAL_MS = 33;

export function useMidiPlayer(
  sequence: PlaybackSequence | null,
): MidiPlayerState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [midiAccessState, setMidiAccessState] = useState<MidiAccessState>(() =>
    typeof navigator.requestMIDIAccess === 'function' ? 'idle' : 'unsupported',
  );
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputOption[]>([]);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState('');
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const selectedMidiOutputIdRef = useRef('');
  const nextMidiMessageIndexRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const panicTimerRef = useRef<number | null>(null);
  const startedAtMsRef = useRef(0);
  const startOffsetRef = useRef(0);
  const positionRef = useRef(0);
  const lastUiUpdateAtMsRef = useRef(0);

  const clearPanicTimer = useCallback(() => {
    if (panicTimerRef.current !== null) {
      window.clearTimeout(panicTimerRef.current);
      panicTimerRef.current = null;
    }
  }, []);

  const cleanupScheduled = useCallback(
    (followUpPanic = true) => {
      const output = getSelectedMidiOutput(
        midiAccessRef.current,
        selectedMidiOutputIdRef.current,
      );
      if (output) {
        clearPanicTimer();
        sendMidiPanic(output);
        if (followUpPanic) {
          panicTimerRef.current = window.setTimeout(
            () => sendMidiPanic(output),
            LOOKAHEAD_SECONDS * 1000 + 80,
          );
        }
      }
    },
    [clearPanicTimer],
  );

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const currentPosition = useCallback(() => {
    if (!intervalRef.current) return positionRef.current;
    return Math.min(
      sequence?.durationSeconds ?? 0,
      startOffsetRef.current +
        (performance.now() - startedAtMsRef.current) / 1000,
    );
  }, [sequence]);

  const stopInternal = useCallback(
    (resetPosition: boolean) => {
      const pos = resetPosition ? 0 : currentPosition();
      clearTimer();
      cleanupScheduled();
      setIsPlaying(false);
      if (resetPosition) {
        positionRef.current = 0;
        setPositionSeconds(0);
      } else {
        positionRef.current = pos;
        setPositionSeconds(pos);
      }
    },
    [cleanupScheduled, clearTimer, currentPosition],
  );

  const scheduleMidiMessage = useCallback(
    (output: MIDIOutput, message: PlaybackMidiMessage, position: number) => {
      const sendAt =
        performance.now() + Math.max(0, message.seconds - position) * 1000;
      output.send(message.data, sendAt);
    },
    [],
  );

  const scheduleWindow = useCallback(() => {
    if (!sequence) return;
    const position = currentPosition();
    const until = position + LOOKAHEAD_SECONDS;

    const output = getSelectedMidiOutput(
      midiAccessRef.current,
      selectedMidiOutputIdRef.current,
    );
    if (!output) {
      stopInternal(false);
      return;
    }

    let i = nextMidiMessageIndexRef.current;
    while (i < sequence.midiMessages.length) {
      const message = sequence.midiMessages[i]!;
      if (message.seconds < position) {
        i += 1;
        continue;
      }
      if (message.seconds > until) break;
      scheduleMidiMessage(output, message, position);
      i += 1;
    }
    nextMidiMessageIndexRef.current = i;

    positionRef.current = position;
    const nowMs = performance.now();
    if (nowMs - lastUiUpdateAtMsRef.current >= UI_UPDATE_INTERVAL_MS) {
      lastUiUpdateAtMsRef.current = nowMs;
      setPositionSeconds(position);
    }
    if (position >= sequence.durationSeconds) {
      stopInternal(true);
    }
  }, [currentPosition, scheduleMidiMessage, sequence, stopInternal]);

  const play = useCallback(async () => {
    if (!sequence || sequence.durationSeconds <= 0) return;
    const output = getSelectedMidiOutput(
      midiAccessRef.current,
      selectedMidiOutputIdRef.current,
    );
    if (!output || sequence.midiMessages.length === 0) return;

    cleanupScheduled(false);
    startOffsetRef.current = Math.min(
      positionRef.current,
      Math.max(0, sequence.durationSeconds - 0.01),
    );
    nextMidiMessageIndexRef.current = firstMidiMessageIndexAtOrAfter(
      sequence.midiMessages,
      startOffsetRef.current,
    );
    startedAtMsRef.current = performance.now();
    setIsPlaying(true);
    clearTimer();
    scheduleWindow();
    intervalRef.current = window.setInterval(scheduleWindow, SCHEDULER_MS);
  }, [cleanupScheduled, clearTimer, scheduleWindow, sequence]);

  const pause = useCallback(() => {
    stopInternal(false);
  }, [stopInternal]);

  const stop = useCallback(() => {
    stopInternal(true);
  }, [stopInternal]);

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(
        0,
        Math.min(seconds, sequence?.durationSeconds ?? 0),
      );
      const wasPlaying = intervalRef.current !== null;
      stopInternal(false);
      positionRef.current = clamped;
      setPositionSeconds(clamped);
      if (wasPlaying) {
        void play();
      }
    },
    [play, sequence, stopInternal],
  );

  const refreshMidiOutputs = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) {
      setMidiOutputs([]);
      setSelectedMidiOutputId('');
      selectedMidiOutputIdRef.current = '';
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
    if (!selectedStillExists) {
      const nextId = outputs[0]?.id ?? '';
      selectedMidiOutputIdRef.current = nextId;
      setSelectedMidiOutputId(nextId);
    }
  }, []);

  const requestMidiAccess = useCallback(async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      setMidiAccessState('unsupported');
      setMidiError('このブラウザはWeb MIDI APIに対応していません。');
      return;
    }

    setMidiAccessState('requesting');
    setMidiError(null);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      setMidiAccessState('ready');
      refreshMidiOutputs();
      access.onstatechange = refreshMidiOutputs;
    } catch (err) {
      setMidiAccessState('denied');
      setMidiError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshMidiOutputs]);

  const selectMidiOutput = useCallback((id: string) => {
    const current = getSelectedMidiOutput(
      midiAccessRef.current,
      selectedMidiOutputIdRef.current,
    );
    if (current) sendMidiPanic(current);
    selectedMidiOutputIdRef.current = id;
    setSelectedMidiOutputId(id);
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      clearPanicTimer();
      cleanupScheduled(false);
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
    };
  }, [cleanupScheduled, clearPanicTimer, clearTimer]);

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

  return {
    isPlaying,
    positionSeconds,
    getPositionSeconds: currentPosition,
    midiAccessState,
    midiError,
    midiOutputs,
    selectedMidiOutputId,
    requestMidiAccess,
    selectMidiOutput,
    play,
    pause,
    stop,
    seek,
  };
}

function getSelectedMidiOutput(
  access: MIDIAccess | null,
  outputId: string,
): MIDIOutput | null {
  if (!access || outputId.length === 0) return null;
  return access.outputs.get(outputId) ?? null;
}

function sendMidiPanic(output: MIDIOutput): void {
  (output as MIDIOutput & { clear?: () => void }).clear?.();
  const now = performance.now();
  for (let channel = 0; channel < 16; channel += 1) {
    output.send([0xb0 | channel, 120, 0], now);
    output.send([0xb0 | channel, 123, 0], now);
  }
}

function firstMidiMessageIndexAtOrAfter(
  messages: PlaybackMidiMessage[],
  seconds: number,
): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (messages[mid]!.seconds < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
      sysex: false,
    } as MidiPermissionDescriptor);
    return status.state;
  } catch {
    return null;
  }
}
