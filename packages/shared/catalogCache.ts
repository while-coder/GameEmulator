const STORE = 'catalogs'
let connection: Promise<IDBDatabase> | undefined

function openCache() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('game-catalog-cache', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); connection = undefined }
      db.onclose = () => { connection = undefined }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  }).catch(error => { connection = undefined; throw error })
}

export async function readCatalogCache<T>(key: string, parse: (value: unknown) => T): Promise<T | undefined> {
  try {
    const database = await openCache()
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (value !== undefined) return parse(value)
  } catch { /* Unavailable or invalid local data must not block a network refresh. */ }
}

export async function cacheCatalog(key: string, value: unknown, signal?: AbortSignal) {
  try {
    const database = await openCache()
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } catch { /* The validated catalog remains usable in memory. */ }
}
