import { useCallback, useState } from 'react';

export interface FailureNotice<T> {
  id: number;
  failure: T;
}

// Keeps showing a failure after its source clears it (e.g. the output changes after a send error).
export function useFailureNotice<T extends object>(
  failure: T | null,
): { notice: FailureNotice<T> | null; dismiss: () => void } {
  const [seen, setSeen] = useState<T | null>(null);
  const [latest, setLatest] = useState<FailureNotice<T> | null>(null);
  const [dismissedId, setDismissedId] = useState(0);
  if (failure !== seen) {
    setSeen(failure);
    if (failure) setLatest({ id: (latest?.id ?? 0) + 1, failure });
  }
  const latestId = latest?.id ?? 0;
  const dismiss = useCallback(() => setDismissedId(latestId), [latestId]);
  return { notice: latest && latest.id !== dismissedId ? latest : null, dismiss };
}
