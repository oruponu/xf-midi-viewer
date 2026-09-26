import { useLayoutEffect } from 'react';
import { resolveTheme } from '../lib/theme.ts';
import type { Theme } from '../lib/theme.ts';
import { useMediaQuery } from './useMediaQuery.ts';

export function useTheme(theme: Theme): void {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolved = resolveTheme(theme, prefersDark);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
}
