import { runTransaction } from '../db.ts';

export interface StoredSoundBank {
  name: string;
  data: ArrayBuffer;
}

const STORE_NAME = 'soundBank';
const KEY = 'user';

export async function loadSavedSoundBank(): Promise<StoredSoundBank | null> {
  const value: unknown = await runTransaction(STORE_NAME, 'readonly', (tx) =>
    tx.objectStore(STORE_NAME).get(KEY),
  );
  return isStoredSoundBank(value) ? value : null;
}

export async function saveSoundBank(bank: StoredSoundBank): Promise<void> {
  await runTransaction(STORE_NAME, 'readwrite', (tx) => tx.objectStore(STORE_NAME).put(bank, KEY));
}

export async function deleteSavedSoundBank(): Promise<void> {
  await runTransaction(STORE_NAME, 'readwrite', (tx) => tx.objectStore(STORE_NAME).delete(KEY));
}

function isStoredSoundBank(value: unknown): value is StoredSoundBank {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; data?: unknown };
  return typeof candidate.name === 'string' && candidate.data instanceof ArrayBuffer;
}
