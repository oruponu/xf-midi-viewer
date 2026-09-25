export interface StoredSoundBank {
  name: string;
  data: ArrayBuffer;
}

const DB_NAME = 'xf-midi-viewer';
const STORE_NAME = 'soundBank';
const KEY = 'user';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadSavedSoundBank(): Promise<StoredSoundBank | null> {
  const value: unknown = await runTransaction('readonly', (store) => store.get(KEY));
  return isStoredSoundBank(value) ? value : null;
}

export async function saveSoundBank(bank: StoredSoundBank): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(bank, KEY));
}

export async function deleteSavedSoundBank(): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(KEY));
}

function isStoredSoundBank(value: unknown): value is StoredSoundBank {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; data?: unknown };
  return typeof candidate.name === 'string' && candidate.data instanceof ArrayBuffer;
}
