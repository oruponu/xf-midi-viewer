import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { useMidiPlayer } from '../hooks/useMidiPlayer.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatKeySignature, tickToBarBeat } from '../lib/smf/timing.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';

interface PlaybackPanelProps {
  sequence: PlaybackSequence;
  timing: SmfTiming | null;
  player: ReturnType<typeof useMidiPlayer>;
}

export function PlaybackPanel({
  sequence,
  timing,
  player,
}: PlaybackPanelProps) {
  const hasMidiMessages =
    sequence.midiMessages.length > 0 && sequence.durationSeconds > 0;
  const midiReady =
    player.midiAccessState === 'ready' &&
    player.selectedMidiOutputId.length > 0;
  const canPlay = hasMidiMessages && midiReady;
  const progress =
    sequence.durationSeconds > 0
      ? player.positionSeconds / sequence.durationSeconds
      : 0;
  const tempoBpm = useMemo(() => {
    if (sequence.tempos.length === 0) return null;
    let segment = sequence.tempos[0]!;
    for (const t of sequence.tempos) {
      if (t.seconds <= player.positionSeconds) segment = t;
      else break;
    }
    return Math.round(segment.bpm);
  }, [player.positionSeconds, sequence.tempos]);
  const positionLabel = useMemo(() => {
    if (!timing || timing.ppq <= 0) return null;
    const tick = secondsToTick(player.positionSeconds, sequence);
    const bb = tickToBarBeat(tick, timing);
    if (!bb) return null;
    return `${String(bb.bar).padStart(3, '0')}.${String(bb.beat).padStart(
      2,
      '0',
    )}.${String(bb.tickInBeat).padStart(4, '0')}`;
  }, [player.positionSeconds, sequence, timing]);
  const keyLabel = useMemo(() => {
    if (!timing || timing.keySignatures.length === 0) return null;
    const tick = secondsToTick(player.positionSeconds, sequence);
    let current = timing.keySignatures[0]!;
    for (const change of timing.keySignatures) {
      if (change.tick <= tick) current = change;
      else break;
    }
    return formatKeySignature(current.signature);
  }, [player.positionSeconds, sequence, timing]);
  const timeSigLabel = useMemo(() => {
    if (!timing || timing.timeSignatures.length === 0) return null;
    const tick = secondsToTick(player.positionSeconds, sequence);
    let current = timing.timeSignatures[0]!;
    for (const change of timing.timeSignatures) {
      if (change.tick <= tick) current = change;
      else break;
    }
    return `${current.signature.numerator}/${current.signature.denominator}`;
  }, [player.positionSeconds, sequence, timing]);

  return (
    <section className="playback-panel" aria-label="MIDI playback">
      <div className="playback-controls">
        <button
          className="transport-button primary"
          type="button"
          disabled={!canPlay}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          title={player.isPlaying ? 'Pause' : 'Play'}
          onClick={() => {
            if (player.isPlaying) player.pause();
            else void player.play();
          }}
        >
          {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          className="transport-button"
          type="button"
          disabled={!canPlay}
          aria-label="Stop"
          title="Stop"
          onClick={player.stop}
        >
          <StopIcon />
        </button>
      </div>

      {positionLabel && (
        <div className="playback-position-group">
          <span
            className="playback-position"
            aria-label="Bar.Beat.Tick"
            title="小節.拍.Tick"
          >
            {positionLabel}
          </span>
          {tempoBpm !== null && (
            <span
              className="playback-tempo"
              aria-label={`Tempo ${tempoBpm} BPM`}
              title="現在のテンポ"
            >
              <span className="playback-tempo-label">テンポ</span>
              <span className="playback-tempo-value">{tempoBpm}</span>
            </span>
          )}
          {keyLabel && (
            <span
              className="playback-key"
              aria-label={`Key ${keyLabel}`}
              title="現在のキー"
            >
              <span className="playback-key-label">キー</span>
              <span className="playback-key-value">{keyLabel}</span>
            </span>
          )}
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
        <span className="timecode">{formatTime(player.positionSeconds)}</span>
        <input
          aria-label="Playback position"
          type="range"
          min="0"
          max={Math.max(0, sequence.durationSeconds)}
          step="0.01"
          value={Math.min(player.positionSeconds, sequence.durationSeconds)}
          disabled={!canPlay}
          style={progressStyle(progress)}
          onChange={(e) => player.seek(e.currentTarget.valueAsNumber)}
        />
        <span className="timecode">{formatTime(sequence.durationSeconds)}</span>
      </div>

      <div className="playback-meta">
        <span>{sequence.notes.length.toLocaleString()} notes</span>
        <span>{sequence.midiMessages.length.toLocaleString()} MIDI events</span>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 3.2c0-.7.8-1.1 1.4-.7l7.2 4.8c.5.4.5 1.1 0 1.4L5.4 13.5c-.6.4-1.4 0-1.4-.7V3.2Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="3" height="10" rx="0.6" />
      <rect x="9" y="3" width="3" height="10" rx="0.6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.8" />
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
