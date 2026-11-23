import { cacheCatalog, readCatalogCache } from '../../shared/catalogCache'
import { catalogDownloadBase } from '../../shared/romUrl'
import { newSaveSlot, type SaveKind } from '../../shared/saveSlots'
import { romExtension, systems, type ConsoleSystem } from './systems'

export type Game = { hash: string; name: string; fileName: string; file_size: number; download_url?: string; screenshot_url?: string; genre?: string; publisher?: string; tags?: string[] }
export type SavedGame = Game & { file: Blob }
export type Snapshot = { key: string; system: ConsoleSystem; hash: string; build: string; slot: string; kind: SaveKind; label: string; gameName?: string; savedAt: number; data: Uint8Array; preview?: Blob }
type Battery = { key: string; data: Blob }
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('console-library', 1)
    request.onupgradeneeded = () => {
      for (const store of ['games', 'states', 'battery']) request.result.createObjectStore(store, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
  })
}
async function read<T>(store: string, key?: string | IDBKeyRange): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store), request = typeof key === 'string' ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function write(store: string, value: unknown, remove = false): Promise<void> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite')
    if (remove) tx.objectStore(store).delete(value as string)
    else tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('保存失败，请检查设备存储空间'))
  })
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export const listGames = async (system: ConsoleSystem) => (await read<(SavedGame & { key: string })[]>('games')).filter(game => game.key.startsWith(system + ':'))
export const getGame = (system: ConsoleSystem, hash: string) => read<SavedGame | undefined>('games', `${system}:${hash}`)
export const removeGame = (system: ConsoleSystem, hash: string) => write('games', `${system}:${hash}`, true)
export async function listStates(system: ConsoleSystem, hash?: string, build?: string) {
  const prefix = hash ? `${system}:${hash}:` : `${system}:`
  const states = await read<Snapshot[]>('states', IDBKeyRange.bound(prefix, `${prefix}\uffff`))
  return states.filter(state => state.system === system && (!hash || state.hash === hash) && (!build || state.build === build))
    .sort((a, b) => b.savedAt - a.savedAt)
}
export const getState = (key: string) => read<Snapshot | undefined>('states', key)
export const removeState = (state: Snapshot) => write('states', state.key, true)
export async function renameState(key: string, label: string): Promise<void> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction('states', 'readwrite')
    const store = tx.objectStore('states')
    const request = store.get(key)
    request.onsuccess = () => {
      const current = request.result as Snapshot | undefined
      if (current) store.put({ ...current, label })
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('无法重命名存档'))
  })
}
export async function putState(system: ConsoleSystem, hash: string, build: string, kind: SaveKind, label: string, data: Uint8Array, gameName?: string, preview?: Blob) {
  if (!data.length) throw new Error('内核返回了空存档')
  const slot = kind === 'quick' ? 'quick' : newSaveSlot()
  await write('states', { key: `${system}:${hash}:${build}:${slot}`, system, hash, build, slot, kind, label, gameName, data, preview, savedAt: Date.now() } satisfies Snapshot)
}
export const getBattery = async (key: string) => (await read<Battery | undefined>('battery', key))?.data
export const putBattery = (key: string, data: Blob) => write('battery', { key, data })
export type PspSaveFile = { path: string; data: Uint8Array }
const pspSavedataKey = 'psp:memory-stick'
export const getPspSavedata = async () => (await read<{ files: PspSaveFile[] } | undefined>('battery', pspSavedataKey))?.files ?? []
export const putPspSavedata = (files: PspSaveFile[]) => write('battery', { key: pspSavedataKey, files })

const maxGameSize = (system: ConsoleSystem) => (system === 'psp' ? 2048 : 64) * 1024 * 1024

export async function importGame(system: ConsoleSystem, file: File): Promise<Game> {
  romExtension(system, file.name)
  if (!file.size || file.size > maxGameSize(system)) throw new Error(`ROM 需在 1 字节至 ${system === 'psp' ? '2 GB' : '64 MB'} 之间`)
  const game: Game = { hash: await sha256(await file.arrayBuffer()), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, file_size: file.size }
  await cacheGame(system, game, file)
  return game
}
export const cacheGame = (system: ConsoleSystem, game: Game, file: Blob) => write('games', {
  ...game,
  // Catalog entries can contain Vue proxies. IndexedDB cannot clone a proxied
  // tags array, even after spreading the outer entry into a plain object.
  tags: game.tags ? [...game.tags] : undefined,
  key: `${system}:${game.hash}`,
  file,
})
const catalogKey = (system: ConsoleSystem, source: string) => `${system}:${new URL(source).href}`

export async function readCachedConsoleCatalog(system: ConsoleSystem, source: string): Promise<Game[] | undefined> {
  const catalog = await readCatalogCache(catalogKey(system, source), value => parseCatalog(system, value, source))
  if (catalog !== undefined || source !== systems[system].catalogUrl) return catalog
  try {
    // Older versions kept a normalized copy in localStorage.
    const cached: unknown = JSON.parse(localStorage.getItem(`console:${system}:catalog`) ?? 'null')
    if (Array.isArray(cached)) return cached.filter(game => typeof game?.hash === 'string' && typeof game.name === 'string')
  } catch { /* Continue with a network refresh. */ }
}

export async function loadCatalog(system: ConsoleSystem, source: string, signal?: AbortSignal): Promise<Game[]> {
  const url = new URL(source)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('游戏源需使用 HTTP 或 HTTPS 地址')
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) })
  if (!response.ok) throw new Error(`读取游戏目录失败 (${response.status})`)
  const value: unknown = await response.json()
  const games = parseCatalog(system, value, url.href)
  signal?.throwIfAborted()
  await cacheCatalog(catalogKey(system, url.href), value, signal)
  signal?.throwIfAborted()
  return games
}

function parseCatalog(system: ConsoleSystem, value: unknown, source: string): Game[] {
  const catalog = value as { games?: unknown[]; rom_url_base?: string } | null
  if (!Array.isArray(catalog?.games)) throw new Error('游戏目录缺少 games 数组')
  const base = catalogDownloadBase(source, catalog.rom_url_base)
  const games: Game[] = catalog.games.map(value => {
    const entry = value as Record<string, unknown> | null
    if (!entry || typeof entry.name !== 'string' || typeof entry.download_url !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) || typeof entry.file_size !== 'number' || !Number.isSafeInteger(entry.file_size) || entry.file_size <= 0 || entry.file_size > maxGameSize(system)) throw new Error('游戏目录条目需包含 name、download_url、sha256 和有效的 file_size')
    const download = new URL(entry.download_url, base)
    if (!['https:', 'http:'].includes(download.protocol)) throw new Error('无效的 ROM 下载地址')
    const fileName = typeof entry.file_name === 'string' ? entry.file_name : decodeURIComponent(download.pathname.split('/').pop() ?? '')
    romExtension(system, fileName)
    return { hash: entry.sha256.toLowerCase(), name: entry.name, fileName, file_size: entry.file_size, download_url: download.href,
      screenshot_url: typeof entry.screenshot_url === 'string' ? new URL(entry.screenshot_url, base).href : undefined,
      genre: typeof entry.genre === 'string' ? entry.genre : undefined, publisher: typeof entry.publisher === 'string' ? entry.publisher : undefined,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : undefined }
  })
  return [...new Map(games.map(game => [game.hash, game])).values()]
}
export async function acquireGame(system: ConsoleSystem, game: Game, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<SavedGame> {
  signal.throwIfAborted()
  const cached = await getGame(system, game.hash)
  if (cached) return cached
  if (!game.download_url) throw new Error('本地 ROM 已移除，请重新导入')
  const response = await fetch(game.download_url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) })
  if (!response.ok) throw new Error(`下载失败 (${response.status})`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('浏览器不支持流式下载')
  const chunks: Uint8Array[] = []; let received = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.length
      if (received > game.file_size) throw new Error('下载大小与游戏目录不一致')
      chunks.push(value); progress(received, game.file_size)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  signal.throwIfAborted()
  const file = new Blob(chunks as BlobPart[])
  if (received !== game.file_size || await sha256(await file.arrayBuffer()) !== game.hash) throw new Error('ROM 校验失败，请刷新游戏目录后重试')
  signal.throwIfAborted()
  await cacheGame(system, game, file)
  return { ...game, file }
}
