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
  const [notice, setNotice] = useState<FailureNotice<T> | null>(null);
  if (failure !== seen) {
    setSeen(failure);
    if (failure) setNotice({ id: (notice?.id ?? 0) + 1, failure });
  }
  const dismiss = useCallback(() => setNotice(null), []);
  return { notice, dismiss };
}
