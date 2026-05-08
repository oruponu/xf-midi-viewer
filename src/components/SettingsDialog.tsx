import { useEffect, useRef } from 'react';
import type { useMidiPlayer } from '../hooks/useMidiPlayer.ts';
import type { Settings } from '../hooks/useSettings.ts';

export function SettingsDialog({
  open,
  settings,
  onChange,
  player,
  onClose,
}: {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  player: ReturnType<typeof useMidiPlayer>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      aria-labelledby="settings-dialog-title"
    >
      <div className="settings-dialog-inner">
        <header className="settings-dialog-header">
          <h2 id="settings-dialog-title">設定</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="閉じる"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="settings-dialog-body">
          <section className="settings-section">
            <h3>自動スクロール</h3>
            <p className="settings-section-desc">
              再生位置に合わせてビューを自動でスクロールします
            </p>
            <ToggleRow
              label="リードシート"
              checked={settings.autoScrollLeadSheet}
              onChange={(v) => onChange({ autoScrollLeadSheet: v })}
            />
            <ToggleRow
              label="歌詞"
              checked={settings.autoScrollLyrics}
              onChange={(v) => onChange({ autoScrollLyrics: v })}
            />
          </section>

          <section className="settings-section">
            <h3>MIDI出力</h3>
            <p className="settings-section-desc">
              再生に使用する MIDI 出力ポートを選択します
            </p>
            <MidiOutputControl player={player} />
          </section>
        </div>
      </div>
    </dialog>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-toggle-label">{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function MidiOutputControl({
  player,
}: {
  player: ReturnType<typeof useMidiPlayer>;
}) {
  return (
    <div className="settings-midi">
      <div className="settings-midi-row">
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
      </div>
      <p className="settings-midi-status">{midiStatusText(player)}</p>
    </div>
  );
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

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
