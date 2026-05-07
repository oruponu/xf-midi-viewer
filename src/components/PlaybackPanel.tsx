import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useMidiPlayer } from '../hooks/useMidiPlayer.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';

interface PlaybackPanelProps {
  sequence: PlaybackSequence;
}

export function PlaybackPanel({ sequence }: PlaybackPanelProps) {
  const player = useMidiPlayer(sequence);
  const hasNotes = sequence.notes.length > 0 && sequence.durationSeconds > 0;
  const progress = hasNotes
    ? player.positionSeconds / sequence.durationSeconds
    : 0;
  const tempoLabel = useMemo(() => {
    const firstTempo = sequence.tempos[0];
    return firstTempo ? `${Math.round(firstTempo.bpm)} BPM` : 'SMPTE';
  }, [sequence.tempos]);

  return (
    <section className="playback-panel" aria-label="MIDI playback">
      <div className="playback-controls">
        <button
          className="transport-button primary"
          type="button"
          disabled={!hasNotes}
          onClick={() => {
            if (player.isPlaying) player.pause();
            else void player.play();
          }}
        >
          {player.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          className="transport-button"
          type="button"
          disabled={!hasNotes}
          onClick={player.stop}
        >
          Stop
        </button>
      </div>

      <div className="playback-timeline">
        <span className="timecode">{formatTime(player.positionSeconds)}</span>
        <input
          aria-label="Playback position"
          type="range"
          min="0"
          max={Math.max(0, sequence.durationSeconds)}
          step="0.01"
          value={Math.min(player.positionSeconds, sequence.durationSeconds)}
          disabled={!hasNotes}
          style={progressStyle(progress)}
          onChange={(e) => player.seek(e.currentTarget.valueAsNumber)}
        />
        <span className="timecode">{formatTime(sequence.durationSeconds)}</span>
      </div>

      <div className="playback-meta">
        <span>{sequence.notes.length.toLocaleString()} notes</span>
        <span>{tempoLabel}</span>
        <label className="volume-control">
          <span>Volume</span>
          <input
            aria-label="Playback volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={player.volume}
            style={progressStyle(player.volume)}
            onChange={(e) => player.setVolume(e.currentTarget.valueAsNumber)}
          />
        </label>
      </div>
    </section>
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
