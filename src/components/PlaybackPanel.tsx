import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useMidiPlayer } from '../hooks/useMidiPlayer.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';

interface PlaybackPanelProps {
  sequence: PlaybackSequence;
}

export function PlaybackPanel({ sequence }: PlaybackPanelProps) {
  const player = useMidiPlayer(sequence);
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
          disabled={!canPlay}
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
          disabled={!canPlay}
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
          disabled={!canPlay}
          style={progressStyle(progress)}
          onChange={(e) => player.seek(e.currentTarget.valueAsNumber)}
        />
        <span className="timecode">{formatTime(sequence.durationSeconds)}</span>
      </div>

      <div className="playback-meta">
        <span>{sequence.notes.length.toLocaleString()} notes</span>
        <span>{sequence.midiMessages.length.toLocaleString()} MIDI events</span>
        <span>{tempoLabel}</span>
      </div>

      <div className="playback-routing">
        <div className="midi-output-row">
          {player.midiAccessState === 'ready' ? (
            <select
              aria-label="MIDI output port"
              className="midi-output-select"
              value={player.selectedMidiOutputId}
              disabled={player.isPlaying}
              onChange={(e) => player.selectMidiOutput(e.currentTarget.value)}
            >
              {player.midiOutputs.length === 0 ? (
                <option value="">MIDIポートなし</option>
              ) : (
                player.midiOutputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {formatOutputName(output)}
                  </option>
                ))
              )}
            </select>
          ) : (
            <button
              className="midi-request-button"
              type="button"
              disabled={
                player.midiAccessState === 'unsupported' ||
                player.midiAccessState === 'requesting'
              }
              onClick={() => void player.requestMidiAccess()}
            >
              {player.midiAccessState === 'requesting' ? '確認中' : 'MIDI許可'}
            </button>
          )}
          <span className="midi-status">{midiStatusText(player)}</span>
        </div>
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

function formatOutputName(output: {
  name: string;
  manufacturer: string;
  connection: MIDIPortConnectionState;
}): string {
  const label = output.manufacturer
    ? `${output.manufacturer} ${output.name}`
    : output.name;
  return output.connection === 'open' ? `${label} (open)` : label;
}

function midiStatusText(player: ReturnType<typeof useMidiPlayer>): string {
  if (player.midiError) return player.midiError;
  switch (player.midiAccessState) {
    case 'unsupported':
      return 'Web MIDI未対応';
    case 'requesting':
      return '権限確認中';
    case 'denied':
      return 'MIDI権限なし';
    case 'ready':
      return player.midiOutputs.length > 0 ? '接続済み' : '出力なし';
    case 'idle':
      return '未接続';
  }
}
