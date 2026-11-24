import type { CustomModelAnimMode } from '../types/studio3d';

export interface SavedGlbAvatarSummary {
  id: string;
  name: string;
  sizeBytes: number;
  savedAt: string;
  flip180: boolean;
  animMode: CustomModelAnimMode;
  isDefault: boolean;
}

export interface SavedGlbAvatarRecord extends SavedGlbAvatarSummary {
  blob: Blob;
}

const DB_NAME = 'sportbyte_studio3d_avatars_v1';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';

// In-memory fallback for environments where IndexedDB is unavailable (e.g. Node unit tests or strict private mode)
const memoryFallbackStore = new Map<string, SavedGlbAvatarRecord>();

export function isSupportedGlbFilename(filename: string): boolean {
  return /\.(glb|gltf)$/i.test(filename.trim());
}

export function formatAvatarSizeMb(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0.0 MB';
  const mb = sizeBytes / (1024 * 1024);
  if (mb < 0.1) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openAvatarDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Gagal membuka penyimpanan avatar lokal.'));
  });
}

function toSummary(rec: SavedGlbAvatarRecord): SavedGlbAvatarSummary {
  return {
    id: rec.id,
    name: rec.name,
    sizeBytes: rec.sizeBytes,
    savedAt: rec.savedAt,
    flip180: rec.flip180,
    animMode: rec.animMode,
    isDefault: rec.isDefault,
  };
}

function sortSummaries(list: SavedGlbAvatarSummary[]): SavedGlbAvatarSummary[] {
  return [...list].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

async function readAllRecords(): Promise<SavedGlbAvatarRecord[]> {
  if (!hasIndexedDb()) {
    return Array.from(memoryFallbackStore.values());
  }
  const db = await openAvatarDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? (req.result as SavedGlbAvatarRecord[]) : [];
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error('Gagal membaca daftar avatar tersimpan.'));
    tx.oncomplete = () => db.close();
  });
}

async function putRecord(rec: SavedGlbAvatarRecord): Promise<void> {
  if (!hasIndexedDb()) {
    memoryFallbackStore.set(rec.id, rec);
    return;
  }
  const db = await openAvatarDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(rec);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Gagal menyimpan avatar ke penyimpanan browser.'));
    };
  });
}

async function writeRecordsBatch(records: SavedGlbAvatarRecord[]): Promise<void> {
  if (!hasIndexedDb()) {
    records.forEach((r) => memoryFallbackStore.set(r.id, r));
    return;
  }
  const db = await openAvatarDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    records.forEach((r) => store.put(r));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Gagal memperbarui daftar avatar.'));
    };
  });
}

export async function listSavedGlbAvatars(): Promise<SavedGlbAvatarSummary[]> {
  const all = await readAllRecords();
  return sortSummaries(all.map(toSummary));
}

export async function getSavedGlbAvatar(id: string): Promise<SavedGlbAvatarRecord | null> {
  if (!hasIndexedDb()) {
    return memoryFallbackStore.get(id) ?? null;
  }
  const db = await openAvatarDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as SavedGlbAvatarRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Gagal memuat avatar tersimpan.'));
    tx.oncomplete = () => db.close();
  });
}

export async function getDefaultSavedGlbAvatar(): Promise<SavedGlbAvatarRecord | null> {
  const all = await readAllRecords();
  if (all.length === 0) return null;
  const preferred = all.find((r) => r.isDefault);
  if (preferred) return preferred;
  return all.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
}

export async function saveGlbAvatar(
  blob: Blob,
  options: {
    name: string;
    flip180: boolean;
    animMode: CustomModelAnimMode;
    makeDefault?: boolean;
  },
): Promise<SavedGlbAvatarSummary> {
  const makeDefault = options.makeDefault ?? true;
  const all = await readAllRecords();
  const updatedExisting = makeDefault
    ? all.map((r) => (r.isDefault ? { ...r, isDefault: false } : r))
    : [];

  const rec: SavedGlbAvatarRecord = {
    id: `glb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: options.name.trim() || 'Avatar.glb',
    sizeBytes: blob.size,
    savedAt: new Date().toISOString(),
    flip180: options.flip180,
    animMode: options.animMode,
    isDefault: makeDefault,
    blob,
  };

  await writeRecordsBatch([...updatedExisting, rec]);
  return toSummary(rec);
}

export async function replaceGlbAvatar(
  targetId: string,
  blob: Blob,
  options: {
    name: string;
    flip180: boolean;
    animMode: CustomModelAnimMode;
    makeDefault?: boolean;
  },
): Promise<SavedGlbAvatarSummary> {
  const existing = await getSavedGlbAvatar(targetId);
  if (!existing) {
    return saveGlbAvatar(blob, options);
  }

  const makeDefault = options.makeDefault ?? true;
  const all = await readAllRecords();
  const updatedOthers = makeDefault
    ? all
        .filter((r) => r.id !== targetId && r.isDefault)
        .map((r) => ({ ...r, isDefault: false }))
    : [];

  const replaced: SavedGlbAvatarRecord = {
    ...existing,
    name: options.name.trim() || existing.name,
    sizeBytes: blob.size,
    savedAt: new Date().toISOString(),
    flip180: options.flip180,
    animMode: options.animMode,
    isDefault: makeDefault,
    blob,
  };

  await writeRecordsBatch([...updatedOthers, replaced]);
  return toSummary(replaced);
}

export async function updateSavedGlbAvatarSettings(
  targetId: string,
  patch: {
    flip180?: boolean;
    animMode?: CustomModelAnimMode;
    makeDefault?: boolean;
  },
): Promise<SavedGlbAvatarSummary | null> {
  const existing = await getSavedGlbAvatar(targetId);
  if (!existing) return null;

  const all = await readAllRecords();
  const updatedOthers = patch.makeDefault
    ? all
        .filter((r) => r.id !== targetId && r.isDefault)
        .map((r) => ({ ...r, isDefault: false }))
    : [];

  const updated: SavedGlbAvatarRecord = {
    ...existing,
    flip180: patch.flip180 ?? existing.flip180,
    animMode: patch.animMode ?? existing.animMode,
    isDefault: patch.makeDefault ?? existing.isDefault,
    savedAt: new Date().toISOString(),
  };

  await writeRecordsBatch([...updatedOthers, updated]);
  return toSummary(updated);
}

export async function deleteSavedGlbAvatar(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryFallbackStore.delete(id);
    return;
  }
  const db = await openAvatarDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Gagal menghapus avatar tersimpan.'));
    };
  });
}

export function clearMemoryFallbackAvatarsForTests(): void {
  memoryFallbackStore.clear();
}
