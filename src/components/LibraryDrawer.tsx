import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './CloseIcon.tsx';

export function LibraryDrawer({
  open,
  docked,
  canDock,
  onClose,
  onToggleDock,
  title,
  children,
}: {
  open: boolean;
  docked: boolean;
  canDock: boolean;
  onClose: () => void;
  onToggleDock: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // A layout effect, so the dialog is shown before the list's effects scroll to the current song.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, docked]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose, docked]);

  const header = (
    <header className="library-drawer-header">
      <div className="library-drawer-title">{title}</div>
      {canDock && (
        <button
          type="button"
          className="icon-button"
          title="一覧を横に固定"
          aria-label="一覧を横に固定"
          aria-pressed={docked}
          onClick={onToggleDock}
        >
          <DockIcon />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        title="閉じる"
        aria-label="閉じる"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </header>
  );

  if (docked) {
    return (
      <aside className="library-drawer library-drawer--docked" aria-label="曲の一覧">
        {header}
        <div className="library-drawer-body">{children}</div>
      </aside>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="library-drawer"
      aria-label="曲の一覧"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {header}
      {open && <div className="library-drawer-body">{children}</div>}
    </dialog>
  );
}

function DockIcon() {
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}
