import { useCallback, useEffect, useRef, useState } from 'react';
import { transposeMidiData } from '../lib/smf/playback.ts';
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
  playbackRate: number;
  keyShift: number;
  requestMidiAccess: () => Promise<void>;
  selectMidiOutput: (id: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setKeyShift: (semitones: number) => void;
  reset: () => void;
}

const LOOKAHEAD_SECONDS = 0.05;
const SCHEDULER_MS = 10;
const UI_UPDATE_INTERVAL_MS = 33;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2.0;
export const PLAYBACK_RATE_STEP = 0.1;
export const KEY_SHIFT_MIN = -6;
export const KEY_SHIFT_MAX = 6;
export const KEY_SHIFT_STEP = 1;

interface MidiSendFailure {
  error: unknown;
}

interface MidiScheduleWindowResult {
  nextIndex: number;
  failed: boolean;
}

export function trySendMidiMessage(
  output: Pick<MIDIOutput, 'send'>,
  data: number[],
  timestamp: number,
  onFailure?: (failure: MidiSendFailure) => void,
): boolean {
  try {
    output.send(data, timestamp);
    return true;
  } catch (error) {
    onFailure?.({ error });
    return false;
  }
}

export function scheduleDueMidiMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
  position: number,
  until: number,
  scheduleMessage: (message: PlaybackMidiMessage) => boolean,
): MidiScheduleWindowResult {
  let i = startIndex;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.seconds > until) break;
    if (message.seconds >= position || !isLiveNoteOn(message.data)) {
      const sent = scheduleMessage(message);
      i += 1;
      if (!sent) return { nextIndex: i, failed: true };
      continue;
    }
    i += 1;
  }
  return { nextIndex: i, failed: false };
}

export function collectChaseMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
): PlaybackMidiMessage[] {
  const chase: PlaybackMidiMessage[] = [];
  for (let i = 0; i < startIndex; i += 1) {
    const message = messages[i]!;
    if (!isNoteMessage(message.data)) chase.push(message);
  }
  return chase;
}

function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const clamped = Math.max(
    PLAYBACK_RATE_MIN,
    Math.min(PLAYBACK_RATE_MAX, rate),
  );
  return Math.round(clamped * 10) / 10;
}

function clampKeyShift(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(
    KEY_SHIFT_MIN,
    Math.min(KEY_SHIFT_MAX, Math.round(semitones)),
  );
}

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
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [keyShift, setKeyShiftState] = useState(0);
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const selectedMidiOutputIdRef = useRef('');
  const nextMidiMessageIndexRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const panicTimerRef = useRef<number | null>(null);
  const startedAtMsRef = useRef(0);
  const startOffsetRef = useRef(0);
  const positionRef = useRef(0);
  const lastUiUpdateAtMsRef = useRef(0);
  const playbackRateRef = useRef(1);
  const keyShiftRef = useRef(0);
  const drumChannelsRef = useRef<ReadonlySet<number>>(new Set());
  const midiSendFailureReportedRef = useRef(false);

  const reportMidiSendFailure = useCallback((failure: MidiSendFailure) => {
    if (midiSendFailureReportedRef.current) return;
    midiSendFailureReportedRef.current = true;
    setMidiError(
      `MIDI送信に失敗しました: ${formatMidiSendError(failure.error)}`,
    );
  }, []);

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
        sendMidiPanic(output, reportMidiSendFailure);
        if (followUpPanic) {
          panicTimerRef.current = window.setTimeout(
            () => sendMidiPanic(output, reportMidiSendFailure),
            LOOKAHEAD_SECONDS * 1000 + 80,
          );
        }
      }
    },
    [clearPanicTimer, reportMidiSendFailure],
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
        ((performance.now() - startedAtMsRef.current) / 1000) *
          playbackRateRef.current,
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
    (
      output: MIDIOutput,
      message: PlaybackMidiMessage,
      position: number,
    ): boolean => {
      const data = transposeMidiData(
        message.data,
        keyShiftRef.current,
        drumChannelsRef.current,
      );
      if (!data) return true;
      const offsetSeconds = Math.max(0, message.seconds - position);
      const sendAt =
        performance.now() + (offsetSeconds / playbackRateRef.current) * 1000;
      return trySendMidiMessage(output, data, sendAt, reportMidiSendFailure);
    },
    [reportMidiSendFailure],
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

    const result = scheduleDueMidiMessages(
      sequence.midiMessages,
      nextMidiMessageIndexRef.current,
      position,
      until,
      (message) => scheduleMidiMessage(output, message, position),
    );
    nextMidiMessageIndexRef.current = result.nextIndex;
    if (result.failed) {
      stopInternal(false);
      return;
    }

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

    midiSendFailureReportedRef.current = false;
    setMidiError(null);
    cleanupScheduled(false);
    startOffsetRef.current = Math.min(
      positionRef.current,
      Math.max(0, sequence.durationSeconds - 0.01),
    );
    nextMidiMessageIndexRef.current = firstMidiMessageIndexAtOrAfter(
      sequence.midiMessages,
      startOffsetRef.current,
    );
    for (const message of collectChaseMessages(
      sequence.midiMessages,
      nextMidiMessageIndexRef.current,
    )) {
      scheduleMidiMessage(output, message, startOffsetRef.current);
    }
    startedAtMsRef.current = performance.now();
    setIsPlaying(true);
    clearTimer();
    scheduleWindow();
    intervalRef.current = window.setInterval(scheduleWindow, SCHEDULER_MS);
  }, [
    cleanupScheduled,
    clearTimer,
    scheduleMidiMessage,
    scheduleWindow,
    sequence,
  ]);

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
      const access = await navigator.requestMIDIAccess({ sysex: true });
      midiAccessRef.current = access;
      setMidiAccessState('ready');
      refreshMidiOutputs();
      access.onstatechange = refreshMidiOutputs;
    } catch (err) {
      setMidiAccessState('denied');
      setMidiError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshMidiOutputs]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const clamped = clampPlaybackRate(rate);
      if (clamped === playbackRateRef.current) return;
      if (intervalRef.current !== null) {
        const now = performance.now();
        const pos = Math.min(
          sequence?.durationSeconds ?? 0,
          startOffsetRef.current +
            ((now - startedAtMsRef.current) / 1000) * playbackRateRef.current,
        );
        startOffsetRef.current = pos;
        startedAtMsRef.current = now;
        positionRef.current = pos;
      }
      playbackRateRef.current = clamped;
      setPlaybackRateState(clamped);
    },
    [sequence],
  );

  const setKeyShift = useCallback(
    (shift: number) => {
      const clamped = clampKeyShift(shift);
      if (clamped === keyShiftRef.current) return;
      keyShiftRef.current = clamped;
      setKeyShiftState(clamped);
      if (intervalRef.current !== null && sequence) {
        const pos = currentPosition();
        cleanupScheduled(false);
        nextMidiMessageIndexRef.current = firstMidiMessageIndexAtOrAfter(
          sequence.midiMessages,
          pos,
        );
      }
    },
    [cleanupScheduled, currentPosition, sequence],
  );

  const reset = useCallback(() => {
    const output = getSelectedMidiOutput(
      midiAccessRef.current,
      selectedMidiOutputIdRef.current,
    );
    if (output) sendMidiReset(output, reportMidiSendFailure);
  }, [reportMidiSendFailure]);

  const selectMidiOutput = useCallback(
    (id: string) => {
      const current = getSelectedMidiOutput(
        midiAccessRef.current,
        selectedMidiOutputIdRef.current,
      );
      if (current) sendMidiPanic(current, reportMidiSendFailure);
      selectedMidiOutputIdRef.current = id;
      setSelectedMidiOutputId(id);
    },
    [reportMidiSendFailure],
  );

  useEffect(() => {
    drumChannelsRef.current = sequence?.drumChannels ?? new Set();
  }, [sequence]);

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
    playbackRate,
    keyShift,
    requestMidiAccess,
    selectMidiOutput,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    setKeyShift,
    reset,
  };
}

function getSelectedMidiOutput(
  access: MIDIAccess | null,
  outputId: string,
): MIDIOutput | null {
  if (!access || outputId.length === 0) return null;
  return access.outputs.get(outputId) ?? null;
}

function isLiveNoteOn(data: number[]): boolean {
  return (data[0]! & 0xf0) === 0x90 && (data[2] ?? 0) > 0;
}

function isNoteMessage(data: number[]): boolean {
  const status = data[0]! & 0xf0;
  return status === 0x80 || status === 0x90 || status === 0xa0;
}

function sendMidiPanic(
  output: MIDIOutput,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  (output as MIDIOutput & { clear?: () => void }).clear?.();
  const now = performance.now();
  for (let channel = 0; channel < 16; channel += 1) {
    trySendMidiMessage(output, [0xb0 | channel, 120, 0], now, onFailure);
    trySendMidiMessage(output, [0xb0 | channel, 123, 0], now, onFailure);
  }
}

function sendMidiReset(
  output: MIDIOutput,
  onFailure?: (failure: MidiSendFailure) => void,
): void {
  const now = performance.now();
  trySendMidiMessage(
    output,
    [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
    now,
    onFailure,
  );
  trySendMidiMessage(
    output,
    [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
    now,
    onFailure,
  );
}

function formatMidiSendError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      sysex: true,
    } as MidiPermissionDescriptor);
    return status.state;
  } catch {
    return null;
  }
}
