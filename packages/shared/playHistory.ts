export type GameSystem = 'nes' | 'arcade'
export type PlayRecord = { lastPlayedAt: number; totalPlayTimeMs: number }
export type PlayHistory = Record<string, PlayRecord>
const prefix = (system: GameSystem) => `game-emulator:play-history:${system}:`

function parseRecord(value: string | null): PlayRecord | undefined {
  try {
    const record = JSON.parse(value ?? 'null')
    if (record && Number.isFinite(record.lastPlayedAt) && record.lastPlayedAt > 0 && Number.isFinite(record.totalPlayTimeMs) && record.totalPlayTimeMs >= 0) return record
  } catch { /* Ignore an invalid history entry without affecting the game library. */ }
}
export function loadPlayHistory(storage: Storage | undefined, system: GameSystem): PlayHistory {
  const history: PlayHistory = {}
  if (!storage) return history
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(prefix(system))) continue
      const record = parseRecord(storage.getItem(key))
      if (record) history[key.slice(prefix(system).length)] = record
    }
  } catch { /* Storage may be unavailable in private or restricted contexts. */ }
  return history
}
export function recordPlay(storage: Storage | undefined, system: GameSystem, key: string, lastPlayedAt: number, elapsedMs: number, fallback?: PlayRecord): PlayRecord {
  let previous = fallback
  try { previous = parseRecord(storage?.getItem(prefix(system) + key) ?? null) ?? previous } catch { /* Retain the in-memory record. */ }
  const record = {
    lastPlayedAt: Math.max(previous?.lastPlayedAt ?? 0, lastPlayedAt),
    totalPlayTimeMs: (previous?.totalPlayTimeMs ?? 0) + Math.max(0, elapsedMs),
  }
  try { storage?.setItem(prefix(system) + key, JSON.stringify(record)) } catch { /* Keep gameplay available when storage is full. */ }
  return record
}
export function sortRecentlyPlayed<T>(games: T[], key: (game: T) => string, history: PlayHistory, legacyTime?: (game: T) => number): T[] {
  return games.slice().sort((a, b) =>
    (history[key(b)]?.lastPlayedAt ?? legacyTime?.(b) ?? 0) - (history[key(a)]?.lastPlayedAt ?? legacyTime?.(a) ?? 0),
  )
}
export function formatPlayTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${Math.max(1, seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const remainder = minutes % 60
  return `${Math.floor(minutes / 60)} 小时${remainder ? ` ${remainder} 分` : ''}`
}

/** Clock reads are monotonic; only successful launches are passed to start(). */
export function createPlaySession(write: (key: string, at: number, elapsedMs: number) => void, clock = () => performance.now(), wallClock = () => Date.now()) {
  let key: string | null = null
  let runningSince: number | null = null
  function flush() {
    if (!key || runningSince === null) return
    const now = clock(), elapsed = Math.max(0, now - runningSince)
    runningSince = now
    if (elapsed > 0) write(key, wallClock(), elapsed)
  }
  function stop() { flush(); key = null; runningSince = null }
  return {
    start(nextKey: string) { stop(); key = nextKey; write(nextKey, wallClock(), 0) },
    setRunning(running: boolean) {
      if (!key) return
      if (running && runningSince === null) runningSince = clock()
      else if (!running && runningSince !== null) { flush(); runningSince = null }
    },
    flush,
    stop,
  }
}
