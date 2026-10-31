import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './CloseIcon.tsx';

export function LibraryDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
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
      className="library-drawer"
      aria-label="曲の一覧"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <header className="library-drawer-header">
        <div className="library-drawer-title">{title}</div>
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
      {open && <div className="library-drawer-body">{children}</div>}
    </dialog>
  );
}
