export const BUILTIN_OUTPUT_ID = 'builtin';

const STORAGE_KEY = 'xf-midi-viewer:output';

export function resolveOutputSelection(
  preferred: string | null,
  availableMidiOutputIds: readonly string[],
  builtinSupported: boolean,
): string {
  if (preferred === null || preferred === BUILTIN_OUTPUT_ID) {
    return builtinSupported ? BUILTIN_OUTPUT_ID : (availableMidiOutputIds[0] ?? '');
  }
  return availableMidiOutputIds.includes(preferred) ? preferred : '';
}

export function isBuiltinPreferred(preferred: string | null, builtinSupported: boolean): boolean {
  return builtinSupported && (preferred === null || preferred === BUILTIN_OUTPUT_ID);
}

export function loadPreferredOutputId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePreferredOutputId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore quota / privacy-mode errors
  }
}
