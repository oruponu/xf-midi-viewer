import { useEffect, useRef } from 'react';
import type { Settings } from '../hooks/useSettings.ts';

export function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
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
