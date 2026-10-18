import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './CloseIcon.tsx';

const TOAST_DURATION_MS = 6000;

export function ErrorToast({
  timerKey,
  onDismiss,
  children,
}: {
  timerKey: number;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const isPaused = isHovered || hasFocus;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (isPaused) return;
    const handle = window.setTimeout(() => onDismissRef.current(), TOAST_DURATION_MS);
    return () => window.clearTimeout(handle);
  }, [isPaused, timerKey]);

  return (
    <section
      className="error error-toast"
      role="alert"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setHasFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHasFocus(false);
      }}
    >
      <div className="error-toast-message">{children}</div>
      <button
        type="button"
        className="icon-button error-toast-close"
        title="閉じる"
        aria-label="閉じる"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </section>
  );
}
