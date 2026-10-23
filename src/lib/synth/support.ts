import bundledSoundBankUrl from '../../generated/GeneralUser-GS-XG.sf3?url';

export const BUNDLED_SOUND_BANK_URL = bundledSoundBankUrl;

export function isBuiltinSynthSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof AudioContext === 'function' &&
    typeof AudioWorkletNode === 'function'
  );
}

export function builtinSynthUnsupportedReason(): string {
  return typeof window !== 'undefined' && !window.isSecureContext
    ? '内蔵音源を使うには HTTPS で開いてください'
    : 'このブラウザは内蔵音源に対応していません';
}

export async function fetchBundledSoundBank(): Promise<ArrayBuffer> {
  // Built URLs are content-hashed, so a stale cached copy is still the right file;
  // GitHub Pages changes the ETag on every deploy, which defeats revalidation.
  // The dev server serves an unhashed URL that must be revalidated.
  const response = await fetch(BUNDLED_SOUND_BANK_URL, {
    cache: import.meta.env.PROD ? 'force-cache' : 'default',
  });
  if (!response.ok) throw new Error(`標準の音源を取得できませんでした (HTTP ${response.status})`);
  return response.arrayBuffer();
}
