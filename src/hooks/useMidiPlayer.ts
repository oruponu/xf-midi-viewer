import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackNote, PlaybackSequence } from '../lib/smf/playback.ts';

interface MidiPlayerState {
  isPlaying: boolean;
  positionSeconds: number;
  volume: number;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
}

interface ScheduledNode {
  oscillator: OscillatorNode;
  gain: GainNode;
}

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const LOOKAHEAD_SECONDS = 0.3;
const SCHEDULER_MS = 40;
const MIN_GAIN = 0.0001;

export function useMidiPlayer(
  sequence: PlaybackSequence | null,
): MidiPlayerState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [volume, setVolumeState] = useState(0.65);
  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const scheduledNodesRef = useRef<ScheduledNode[]>([]);
  const scheduledIdsRef = useRef<Set<number>>(new Set());
  const intervalRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startOffsetRef = useRef(0);
  const positionRef = useRef(0);
  const volumeRef = useRef(volume);

  const cleanupScheduled = useCallback(() => {
    for (const node of scheduledNodesRef.current) {
      try {
        node.oscillator.stop();
      } catch {
        // The node may already have ended.
      }
      node.oscillator.disconnect();
      node.gain.disconnect();
    }
    scheduledNodesRef.current = [];
    scheduledIdsRef.current.clear();
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const ensureAudio = useCallback((): AudioContext => {
    if (contextRef.current && masterGainRef.current) return contextRef.current;

    const AudioContextClass =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    const context = new AudioContextClass();
    const masterGain = context.createGain();
    masterGain.gain.value = volumeRef.current;
    masterGain.connect(context.destination);
    contextRef.current = context;
    masterGainRef.current = masterGain;
    return context;
  }, []);

  const currentPosition = useCallback(() => {
    const context = contextRef.current;
    if (!context || !intervalRef.current) return positionRef.current;
    return Math.min(
      sequence?.durationSeconds ?? 0,
      startOffsetRef.current + context.currentTime - startedAtRef.current,
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

  const scheduleNote = useCallback(
    (
      context: AudioContext,
      note: PlaybackNote,
      id: number,
      position: number,
    ) => {
      const masterGain = masterGainRef.current;
      if (!masterGain) return;

      const noteEnd = note.startSeconds + note.durationSeconds;
      const audibleStart = Math.max(note.startSeconds, position);
      const startAt =
        context.currentTime + Math.max(0, note.startSeconds - position);
      const duration = Math.max(0.03, noteEnd - audibleStart);
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      const isDrum = note.channel === 9;
      const velocityGain = (note.velocity / 127) * (isDrum ? 0.18 : 0.12);

      oscillator.type = isDrum ? 'square' : waveformForChannel(note.channel);
      oscillator.frequency.setValueAtTime(
        isDrum ? drumFrequency(note.note) : midiNoteToFrequency(note.note),
        startAt,
      );

      gain.gain.setValueAtTime(MIN_GAIN, startAt);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(MIN_GAIN, velocityGain),
        startAt + 0.01,
      );
      gain.gain.exponentialRampToValueAtTime(
        MIN_GAIN,
        startAt + (isDrum ? Math.min(duration, 0.16) : duration),
      );

      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.04);
      oscillator.addEventListener(
        'ended',
        () => {
          oscillator.disconnect();
          gain.disconnect();
          scheduledNodesRef.current = scheduledNodesRef.current.filter(
            (node) => node.oscillator !== oscillator,
          );
        },
        { once: true },
      );

      scheduledIdsRef.current.add(id);
      scheduledNodesRef.current.push({ oscillator, gain });
    },
    [],
  );

  const scheduleWindow = useCallback(() => {
    if (!sequence) return;
    const context = contextRef.current;
    if (!context) return;

    const position = currentPosition();
    const until = position + LOOKAHEAD_SECONDS;
    for (let i = 0; i < sequence.notes.length; i += 1) {
      if (scheduledIdsRef.current.has(i)) continue;
      const note = sequence.notes[i]!;
      const noteEnd = note.startSeconds + note.durationSeconds;
      if (noteEnd < position) continue;
      if (note.startSeconds > until) break;
      scheduleNote(context, note, i, position);
    }

    positionRef.current = position;
    setPositionSeconds(position);
    if (position >= sequence.durationSeconds) {
      stopInternal(true);
    }
  }, [currentPosition, scheduleNote, sequence, stopInternal]);

  const play = useCallback(async () => {
    if (!sequence || sequence.durationSeconds <= 0) return;
    const context = ensureAudio();
    if (context.state === 'suspended') await context.resume();

    cleanupScheduled();
    scheduledIdsRef.current.clear();
    startOffsetRef.current = Math.min(
      positionRef.current,
      Math.max(0, sequence.durationSeconds - 0.01),
    );
    startedAtRef.current = context.currentTime;
    setIsPlaying(true);
    clearTimer();
    scheduleWindow();
    intervalRef.current = window.setInterval(scheduleWindow, SCHEDULER_MS);
  }, [cleanupScheduled, clearTimer, ensureAudio, scheduleWindow, sequence]);

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

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    const context = contextRef.current;
    const masterGain = masterGainRef.current;
    if (context && masterGain) {
      masterGain.gain.setTargetAtTime(clamped, context.currentTime, 0.02);
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      cleanupScheduled();
      void contextRef.current?.close();
    };
  }, [cleanupScheduled, clearTimer]);

  return {
    isPlaying,
    positionSeconds,
    volume,
    play,
    pause,
    stop,
    seek,
    setVolume,
  };
}

function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function waveformForChannel(channel: number): OscillatorType {
  return channel % 3 === 0
    ? 'triangle'
    : channel % 3 === 1
      ? 'sine'
      : 'sawtooth';
}

function drumFrequency(note: number): number {
  if (note < 42) return 74;
  if (note < 50) return 118;
  return 190;
}
