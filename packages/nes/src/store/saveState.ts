/**
 * 存档点持久化:把引擎状态快照存入 IndexedDB,按 (romKey, slot) 索引。
 *
 * 与 ROM 缓存(romLibrary)分库,互不影响。slot 为任意字符串,当前 UI 仅用
 * 'quick' 单槽快速存读,但存储层支持多槽位,便于以后扩展存档列表。
 */
import type { SaveState } from '../emulator/runner'

/**
 * 存档类型:
 * - 'quick' 快速存档,S 键覆盖式写入,每个游戏只占一个固定槽。
 * - 'normal' 普通存档,新建时追加一条独立槽,可保留多份。
 */
export type SaveKind = 'quick' | 'normal'

export type SaveStateRecord = {
  /** 主键:`${romKey}:${slot}`。 */
  key: string
  romKey: string
  slot: string
  /** 存档类型;旧记录无此字段时由 saveKindOf 按 slot 回退推断。 */
  kind?: SaveKind
  /** 存档时的 ROM 显示名,供存档列表按游戏分组/过滤展示。 */
  name: string
  /** 用户可编辑的存档名;旧记录无此字段时展示层回退到 name。 */
  label?: string
  state: SaveState
  savedAt: number
}

/** 快速存档固定占用的槽名(覆盖式单槽)。 */
export const QUICK_SLOT = 'quick'

/** 判定一条存档的类型;兼容没有 kind 字段的旧记录(按是否为快速槽推断)。 */
export function saveKindOf(record: SaveStateRecord): SaveKind {
  return record.kind ?? (record.slot === QUICK_SLOT ? 'quick' : 'normal')
}

const DB_NAME = 'nes-save-states'
const DB_VERSION = 1
const STORE_NAME = 'saves'

let dbPromise: Promise<IDBDatabase> | null = null
// 同一毫秒内多次新建存档时用于区分 slot,避免主键冲突。
let slotSeq = 0

function recordKey(romKey: string, slot: string): string {
  return `${romKey}:${slot}`
}

/** 生成一个不重复的存档 slot,用于多存档列表的新建。 */
function newSlot(): string {
  return `s-${Date.now()}-${(slotSeq++).toString(36)}`
}

export async function putSaveState(
  romKey: string,
  slot: string,
  name: string,
  state: SaveState,
  label?: string,
  kind: SaveKind = 'quick',
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const record: SaveStateRecord = {
    key: recordKey(romKey, slot),
    romKey,
    slot,
    kind,
    name,
    label,
    state,
    savedAt: Date.now(),
  }
  await requestToPromise(tx.objectStore(STORE_NAME).put(record))
  await done
}

/** 新建一条多存档列表用的存档(自动分配唯一 slot),返回新记录。 */
export async function createSaveState(
  romKey: string,
  name: string,
  label: string,
  state: SaveState,
): Promise<SaveStateRecord> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const slot = newSlot()
  const record: SaveStateRecord = {
    key: recordKey(romKey, slot),
    romKey,
    slot,
    kind: 'normal',
    name,
    label,
    state,
    savedAt: Date.now(),
  }
  await requestToPromise(tx.objectStore(STORE_NAME).put(record))
  await done
  return record
}

/** 列出全部存档(跨游戏,按存档时间倒序),供存档列表「全部」视图用。 */
export async function listAllSaveStates(): Promise<SaveStateRecord[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const all = await requestToPromise<SaveStateRecord[]>(tx.objectStore(STORE_NAME).getAll())
  await done
  return all.sort((a, b) => b.savedAt - a.savedAt)
}

/** 修改某条存档的显示名(label)。 */
export async function renameSaveState(key: string, label: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const store = tx.objectStore(STORE_NAME)
  const record = await requestToPromise<SaveStateRecord | undefined>(store.get(key))
  if (record) {
    record.label = label
    await requestToPromise(store.put(record))
  }
  await done
}

/** 按主键删除一条存档(配合 listAllSaveStates 的跨游戏列表)。 */
export async function deleteSaveStateByKey(key: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  await requestToPromise(tx.objectStore(STORE_NAME).delete(key))
  await done
}

export async function getSaveState(romKey: string, slot: string): Promise<SaveStateRecord | null> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const record = await requestToPromise<SaveStateRecord | undefined>(
    tx.objectStore(STORE_NAME).get(recordKey(romKey, slot)),
  )
  await done
  return record ?? null
}

/** 列出某卡带的全部存档点(按存档时间倒序)。 */
export async function listSaveStates(romKey: string): Promise<SaveStateRecord[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const all = await requestToPromise<SaveStateRecord[]>(tx.objectStore(STORE_NAME).getAll())
  await done
  return all.filter((r) => r.romKey === romKey).sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteSaveState(romKey: string, slot: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  await requestToPromise(tx.objectStore(STORE_NAME).delete(recordKey(romKey, slot)))
  await done
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // 连接被外部(如 DevTools 清库、其他标签升级版本)关闭后,缓存的句柄会失效,
      // 后续事务全部抛 InvalidStateError。丢弃缓存,让下次 openDb 重新打开。
      db.onclose = () => {
        if (dbPromise) dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        if (dbPromise) dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开存档库'))
  })
  // 打开失败时不要把 rejected promise 永久缓存,否则之后每次存档都复用它而必失败。
  dbPromise.catch(() => {
    dbPromise = null
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
