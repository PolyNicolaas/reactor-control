// Camera media (time-lapse frames, clips, snapshots) kept in the browser's IndexedDB until the
// recording is downloaded, so large files do not sit in memory. Cleared when a new recording starts, except the files of the
// previous recording while it has not been downloaded (a change can start a recording by itself, D31).
// Planned (DESIGN §9): uploaded to the host as they are made.

const DB = 'reactor-control-media';
const STORE = 'media';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const mediaStore = {
  put: (name: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, name)),
  get: (name: string) => tx<Blob | undefined>('readonly', (s) => s.get(name)),
  clear: () => tx('readwrite', (s) => s.clear()),
  /** Delete every file except these (the previous recording, while it has not been downloaded). */
  clearExcept: async (keep: Set<string>) => {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const drop = keys.filter((k) => !keep.has(String(k)));
    if (drop.length) await tx('readwrite', (s) => { let r!: IDBRequest; for (const k of drop) r = s.delete(k); return r; });
  },
};
