import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePlaybackPosition } from '../hooks/usePlaybackPosition.ts';
import {
  KEY_SHIFT_MAX,
  KEY_SHIFT_MIN,
  KEY_SHIFT_STEP,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  PLAYBACK_RATE_STEP,
} from '../lib/player/scheduler.ts';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatKeySignature, shiftKeySignature, tickToBarBeat } from '../lib/smf/timing.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';

interface PlaybackPanelProps {
  sequence: PlaybackSequence;
  timing: SmfTiming | null;
  scheduler: MidiScheduler;
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  midiReady: boolean;
}

export function PlaybackPanel({
  sequence,
  timing,
  scheduler,
  isPlaying,
  playbackRate,
  keyShift,
  midiReady,
}: PlaybackPanelProps) {
  const hasMidiMessages = sequence.midiMessages.length > 0 && sequence.durationSeconds > 0;
  const canPlay = hasMidiMessages && midiReady;

  return (
    <section className="playback-panel" aria-label="MIDI playback">
      <div className="playback-controls">
        <button
          className="transport-button primary"
          type="button"
          disabled={!canPlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
          onClick={() => {
            if (isPlaying) scheduler.pause();
            else scheduler.play();
          }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          className="transport-button"
          type="button"
          disabled={!canPlay}
          aria-label="Stop"
          title="Stop"
          onClick={() => scheduler.stop()}
        >
          <StopIcon />
        </button>
      </div>

      <PlaybackReadout
        sequence={sequence}
        timing={timing}
        scheduler={scheduler}
        playbackRate={playbackRate}
        keyShift={keyShift}
        canPlay={canPlay}
      />

      <div className="playback-meta">
        <span>{sequence.notes.length.toLocaleString()} notes</span>
        <span>{sequence.midiMessages.length.toLocaleString()} MIDI events</span>
      </div>
    </section>
  );
}

interface PlaybackReadoutProps {
  sequence: PlaybackSequence;
  timing: SmfTiming | null;
  scheduler: MidiScheduler;
  playbackRate: number;
  keyShift: number;
  canPlay: boolean;
}

function PlaybackReadout({
  sequence,
  timing,
  scheduler,
  playbackRate,
  keyShift,
  canPlay,
}: PlaybackReadoutProps) {
  const playbackSeconds = usePlaybackPosition(scheduler, (seconds) => seconds);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const positionSeconds = dragSeconds ?? playbackSeconds;
  const sliderRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const commit = () => {
      scheduler.seek(slider.valueAsNumber);
      setDragSeconds(null);
    };
    const cancel = () => setDragSeconds(null);
    slider.addEventListener('change', commit);
    slider.addEventListener('pointercancel', cancel);
    slider.addEventListener('blur', cancel);
    return () => {
      slider.removeEventListener('change', commit);
      slider.removeEventListener('pointercancel', cancel);
      slider.removeEventListener('blur', cancel);
    };
  }, [scheduler]);

  const progress = sequence.durationSeconds > 0 ? positionSeconds / sequence.durationSeconds : 0;
  const tempoBpm = useMemo(() => {
    if (sequence.tempos.length === 0) return null;
    let segment = sequence.tempos[0]!;
    for (const t of sequence.tempos) {
      if (t.seconds <= positionSeconds) segment = t;
      else break;
    }
    return Math.round(segment.bpm * playbackRate);
  }, [playbackRate, positionSeconds, sequence.tempos]);
  const canDecreaseRate = playbackRate > PLAYBACK_RATE_MIN + 1e-6;
  const canIncreaseRate = playbackRate < PLAYBACK_RATE_MAX - 1e-6;
  const isRateModified = Math.abs(playbackRate - 1) > 1e-6;
  const playbackRateLabel = `×${playbackRate.toFixed(1)}`;
  const positionLabel = useMemo(() => {
    if (!timing || timing.ppq <= 0) return null;
    const tick = secondsToTick(positionSeconds, sequence);
    const bb = tickToBarBeat(tick, timing);
    if (!bb) return null;
    return `${String(bb.bar).padStart(3, '0')}.${String(bb.beat).padStart(
      2,
      '0',
    )}.${String(bb.tickInBeat).padStart(4, '0')}`;
  }, [positionSeconds, sequence, timing]);
  const keyLabel = useMemo(() => {
    if (!timing || timing.keySignatures.length === 0) return null;
    const tick = secondsToTick(positionSeconds, sequence);
    let current = timing.keySignatures[0]!;
    for (const change of timing.keySignatures) {
      if (change.tick <= tick) current = change;
      else break;
    }
    const shifted =
      keyShift === 0 ? current.signature : shiftKeySignature(current.signature, keyShift);
    return formatKeySignature(shifted);
  }, [keyShift, positionSeconds, sequence, timing]);
  const canDecreaseShift = keyShift > KEY_SHIFT_MIN;
  const canIncreaseShift = keyShift < KEY_SHIFT_MAX;
  const isShiftModified = keyShift !== 0;
  const keyShiftLabel = keyShift > 0 ? `+${keyShift}` : String(keyShift);
  const timeSigLabel = useMemo(() => {
    if (!timing || timing.timeSignatures.length === 0) return null;
    const tick = secondsToTick(positionSeconds, sequence);
    let current = timing.timeSignatures[0]!;
    for (const change of timing.timeSignatures) {
      if (change.tick <= tick) current = change;
      else break;
    }
    return `${current.signature.numerator}/${current.signature.denominator}`;
  }, [positionSeconds, sequence, timing]);

  return (
    <>
      {positionLabel && (
        <div className="playback-position-group">
          <span className="playback-position" aria-label="Bar.Beat.Tick" title="小節.拍.Tick">
            {positionLabel}
          </span>
          {tempoBpm !== null && (
            <span
              className="playback-tempo"
              aria-label={`Tempo ${tempoBpm} BPM, rate ${playbackRateLabel}`}
              title="現在のテンポ（倍率適用後）"
            >
              <span className="playback-tempo-header">
                <span className="playback-tempo-label">テンポ</span>
                <span
                  className={
                    isRateModified
                      ? 'playback-tempo-value playback-tempo-value--modified'
                      : 'playback-tempo-value'
                  }
                >
                  {tempoBpm}
                </span>
              </span>
              <span className="playback-tempo-rate">
                <button
                  type="button"
                  className="playback-rate-button"
                  aria-label="倍率を下げる"
                  title="倍率を下げる"
                  disabled={!canDecreaseRate}
                  onClick={() => scheduler.setPlaybackRate(playbackRate - PLAYBACK_RATE_STEP)}
                >
                  <ChevronDownIcon />
                </button>
                <span className="playback-rate-value">{playbackRateLabel}</span>
                <button
                  type="button"
                  className="playback-rate-button"
                  aria-label="倍率を上げる"
                  title="倍率を上げる"
                  disabled={!canIncreaseRate}
                  onClick={() => scheduler.setPlaybackRate(playbackRate + PLAYBACK_RATE_STEP)}
                >
                  <ChevronUpIcon />
                </button>
              </span>
            </span>
          )}
          <span
            className="playback-key"
            aria-label={`Key ${keyLabel ?? 'unknown'}, shift ${keyShiftLabel}`}
            title="現在のキー（移調適用後）"
          >
            <span className="playback-key-header">
              <span className="playback-key-label">キー</span>
              <span
                className={
                  isShiftModified
                    ? 'playback-key-value playback-key-value--modified'
                    : 'playback-key-value'
                }
              >
                {keyLabel ?? '—'}
              </span>
            </span>
            <span className="playback-key-shift">
              <button
                type="button"
                className="playback-rate-button"
                aria-label="移調を下げる"
                title="移調を下げる"
                disabled={!canDecreaseShift}
                onClick={() => scheduler.setKeyShift(keyShift - KEY_SHIFT_STEP)}
              >
                <ChevronDownIcon />
              </button>
              <span className="playback-rate-value">{keyShiftLabel}</span>
              <button
                type="button"
                className="playback-rate-button"
                aria-label="移調を上げる"
                title="移調を上げる"
                disabled={!canIncreaseShift}
                onClick={() => scheduler.setKeyShift(keyShift + KEY_SHIFT_STEP)}
              >
                <ChevronUpIcon />
              </button>
            </span>
          </span>
          {timeSigLabel && (
            <span
              className="playback-time-sig"
              aria-label={`Time signature ${timeSigLabel}`}
              title="現在の拍子"
            >
              <span className="playback-time-sig-label">拍子</span>
              <span className="playback-time-sig-value">{timeSigLabel}</span>
            </span>
          )}
        </div>
      )}

      <div className="playback-timeline">
        <span className="timecode">{formatTime(positionSeconds)}</span>
        <input
          ref={sliderRef}
          aria-label="Playback position"
          type="range"
          min="0"
          max={Math.max(0, sequence.durationSeconds)}
          step="0.01"
          value={Math.min(positionSeconds, sequence.durationSeconds)}
          disabled={!canPlay}
          style={progressStyle(progress)}
          onChange={(e) => setDragSeconds(e.currentTarget.valueAsNumber)}
        />
        <span className="timecode">{formatTime(sequence.durationSeconds)}</span>
      </div>
    </>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 3.2c0-.7.8-1.1 1.4-.7l7.2 4.8c.5.4.5 1.1 0 1.4L5.4 13.5c-.6.4-1.4 0-1.4-.7V3.2Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" rx="0.6" />
      <rect x="9" y="3" width="3" height="10" rx="0.6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.8" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 7.5 6 4l3.5 3.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

function progressStyle(value: number): CSSProperties {
  return {
    '--progress': `${Math.max(0, Math.min(1, value)) * 100}%`,
  } as CSSProperties;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}
