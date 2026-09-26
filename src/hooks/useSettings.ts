import { useCallback, useEffect, useState } from 'react';
import { isTheme } from '../lib/theme.ts';
import type { Theme } from '../lib/theme.ts';

const STORAGE_KEY = 'xf-midi-viewer:settings';

export interface Settings {
  autoScrollLeadSheet: boolean;
  autoScrollLyrics: boolean;
  showPitchBar: boolean;
  theme: Theme;
}

const DEFAULT_SETTINGS: Settings = {
  autoScrollLeadSheet: true,
  autoScrollLyrics: true,
  showPitchBar: true,
  theme: 'system',
};

function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
    return {
      autoScrollLeadSheet: readBoolean(parsed, 'autoScrollLeadSheet'),
      autoScrollLyrics: readBoolean(parsed, 'autoScrollLyrics'),
      showPitchBar: readBoolean(parsed, 'showPitchBar'),
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readBoolean(parsed: Partial<Settings>, key: Exclude<keyof Settings, 'theme'>): boolean {
  const value = parsed[key];
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key];
}

export function useSettings(): {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
} {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, updateSettings };
}
