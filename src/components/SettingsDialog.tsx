import { useEffect, useRef } from 'react';
import type { MidiPlayer } from '../hooks/useMidiPlayer.ts';
import type { Settings } from '../hooks/useSettings.ts';
import { BUILTIN_OUTPUT_ID } from '../lib/player/outputSelection.ts';
import { BUNDLED_SOUND_BANK } from '../lib/synth/soundBank.ts';
import type { BuiltinSynth } from '../hooks/useBuiltinSynth.ts';

export type PlayerOutputProps = Pick<
  MidiPlayer,
  | 'midiAccessState'
  | 'playerError'
  | 'midiOutputs'
  | 'selectedOutputId'
  | 'isPlaying'
  | 'builtin'
  | 'requestMidiAccess'
  | 'selectOutput'
>;

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
  player: PlayerOutputProps;
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
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
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
            <h3>カラオケビュー</h3>
            <p className="settings-section-desc">カラオケビューの表示内容を切り替えます</p>
            <ToggleRow
              label="音程バー"
              checked={settings.showPitchBar}
              onChange={(v) => onChange({ showPitchBar: v })}
            />
          </section>

          <section className="settings-section">
            <h3>出力</h3>
            <p className="settings-section-desc">再生に使う音源を選択します</p>
            <OutputControl player={player} />
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

function OutputControl({ player }: { player: PlayerOutputProps }) {
  const { builtin } = player;
  const canRequestMidi =
    player.midiAccessState !== 'ready' && player.midiAccessState !== 'unsupported';
  return (
    <div className="settings-midi">
      <div className="settings-midi-row">
        <select
          aria-label="出力先"
          className="midi-output-select"
          value={player.selectedOutputId}
          disabled={player.isPlaying}
          onChange={(e) => player.selectOutput(e.currentTarget.value)}
        >
          {player.selectedOutputId === '' && (
            <option value="" disabled>
              未接続
            </option>
          )}
          <option value={BUILTIN_OUTPUT_ID} disabled={builtin.status === 'unsupported'}>
            内蔵音源（{(builtin.soundBank ?? BUNDLED_SOUND_BANK).name}）
          </option>
          {player.midiOutputs.map((output) => (
            <option key={output.id} value={output.id}>
              {formatOutputName(output)}
            </option>
          ))}
        </select>
        {canRequestMidi && (
          <button
            className="midi-request-button"
            type="button"
            disabled={player.midiAccessState === 'requesting'}
            onClick={() => void player.requestMidiAccess()}
          >
            {player.midiAccessState === 'requesting' ? '確認中' : 'MIDI許可'}
          </button>
        )}
        {player.selectedOutputId === BUILTIN_OUTPUT_ID && builtin.status === 'error' && (
          <button className="midi-request-button" type="button" onClick={builtin.retry}>
            再読み込み
          </button>
        )}
      </div>
      <p className="settings-midi-status">{outputStatusText(player)}</p>
      {player.selectedOutputId === BUILTIN_OUTPUT_ID && builtin.status === 'ready' && (
        <SoundBankControl builtin={builtin} disabled={player.isPlaying || builtin.isBusy} />
      )}
    </div>
  );
}

function outputStatusText(player: PlayerOutputProps): string {
  if (player.playerError) return player.playerError;
  const { builtin } = player;
  if (player.selectedOutputId === BUILTIN_OUTPUT_ID) {
    switch (builtin.status) {
      case 'unsupported':
      case 'error':
        return builtin.error ?? '内蔵音源を使用できません';
      case 'idle':
      case 'loading':
        return '音源を読み込み中';
      case 'ready':
        return '内蔵音源を使用中';
    }
  }
  if (player.selectedOutputId !== '') return '接続済み';
  if (builtin.status === 'unsupported' && builtin.error) return builtin.error;
  return player.midiAccessState === 'denied' ? 'MIDI権限なし' : '未接続';
}

function SoundBankControl({ builtin, disabled }: { builtin: BuiltinSynth; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = builtin.soundBank ?? BUNDLED_SOUND_BANK;
  const next = builtin.nextSoundBank;
  const showNext = next.name !== current.name || next.bundled !== current.bundled;
  return (
    <div className="settings-midi">
      <p className="settings-midi-status">使用中の SoundFont: {current.name}</p>
      {showNext && <p className="settings-midi-status">次回読み込む SoundFont: {next.name}</p>}
      <div className="settings-midi-row">
        <input
          ref={inputRef}
          type="file"
          accept=".sf2,.sf3,.dls"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void builtin.loadUserSoundBank(file);
          }}
        />
        <button
          className="midi-request-button"
          type="button"
          disabled={disabled}
          onClick={() => {
            builtin.unlockAudio();
            inputRef.current?.click();
          }}
        >
          読み込み
        </button>
        <button
          className="midi-request-button"
          type="button"
          disabled={disabled || (current.bundled && next.bundled)}
          onClick={() => void builtin.resetSoundBank()}
        >
          標準に戻す
        </button>
      </div>
      {builtin.isBusy && <p className="settings-midi-status">読み込み中</p>}
      {builtin.notice && (
        <p className="settings-midi-status" role="status">
          {builtin.notice}
        </p>
      )}
      <p className="settings-section-desc">スマホでは大きな SoundFont は避けてください</p>
    </div>
  );
}

function formatOutputName(output: {
  name: string;
  manufacturer: string;
  connection: MIDIPortConnectionState;
}): string {
  const label = output.manufacturer ? `${output.manufacturer} ${output.name}` : output.name;
  return output.connection === 'open' ? `${label} (open)` : label;
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
