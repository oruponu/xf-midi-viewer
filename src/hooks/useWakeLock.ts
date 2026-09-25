import { useEffect } from 'react';

export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (acquired) => {
          if (cancelled) {
            void acquired.release();
            return;
          }
          sentinel = acquired;
          acquired.addEventListener('release', acquire);
        },
        () => {},
      );
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (sentinel === null || sentinel.released)) {
        acquire();
      }
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
    };
  }, [enabled]);
}
