import { romKey, type RomEntry } from './romCatalog'

export type CachedRom = {
  key: string
  name: string
  bytes: Uint8Array
  size: number
  sha256?: string
  genre?: string
  publisher?: string
  mapper?: number
  tags?: string[]
  savedAt: number
  lastPlayedAt?: number
}

const DB_NAME = 'nes-rom-library'
const DB_VERSION = 2
const STORE_NAME = 'roms'

let dbPromise: Promise<IDBDatabase> | null = null

export async function listCachedRomKeys(): Promise<Set<string>> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const keys = await requestToPromise<IDBValidKey[]>(tx.objectStore(STORE_NAME).getAllKeys())
  await done
  return new Set(keys.filter((key): key is string => typeof key === 'string'))
}

export async function listCachedRoms(): Promise<CachedRom[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const roms = await requestToPromise<CachedRom[]>(tx.objectStore(STORE_NAME).getAll())
  await done
  return roms.sort((a, b) => (b.lastPlayedAt ?? b.savedAt) - (a.lastPlayedAt ?? a.savedAt))
}

export async function getCachedRom(key: string): Promise<CachedRom | null> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const rom = await requestToPromise<CachedRom | undefined>(tx.objectStore(STORE_NAME).get(key))
  await done
  return rom ?? null
}

export async function saveCachedRom(entry: RomEntry, bytes: Uint8Array): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const record: CachedRom = {
    key: romKey(entry),
    name: entry.name,
    bytes,
    size: bytes.byteLength,
    sha256: entry.sha256,
    genre: entry.genre,
    publisher: entry.publisher,
    mapper: entry.mapper,
    tags: entry.tags ? [...entry.tags] : undefined,
    savedAt: Date.now(),
  }
  await requestToPromise(tx.objectStore(STORE_NAME).put(record))
  await done
}

export async function touchCachedRom(key: string): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const store = tx.objectStore(STORE_NAME)
  const rom = await requestToPromise<CachedRom | undefined>(store.get(key))
  const now = Date.now()
  if (rom) {
    rom.lastPlayedAt = now
    await requestToPromise(store.put(rom))
  }
  await done
  return now
}

export async function deleteCachedRom(key: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  await requestToPromise(tx.objectStore(STORE_NAME).delete(key))
  await done
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME)
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开 ROM 缓存'))
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
  })
}
