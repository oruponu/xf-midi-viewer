export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
