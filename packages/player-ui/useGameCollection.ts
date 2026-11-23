import { computed, onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from 'vue'
import type { GameSystem } from '../shared/playHistory'

type Entry = { favorite: boolean; game: unknown }
const collections = new Map<GameSystem, ShallowRef<Record<string, Entry>>>()

function storage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
}

export function useGameCollection<T>(system: GameSystem) {
  const prefix = `game-emulator:collection:${system}:`
  function read() {
    const entries: Record<string, Entry> = {}
    try {
      const saved = storage()
      for (let i = 0; saved && i < saved.length; i++) {
        const key = saved.key(i)
        if (!key?.startsWith(prefix)) continue
        try {
          const entry = JSON.parse(saved.getItem(key) ?? 'null')
          if (entry && typeof entry.favorite === 'boolean' && entry.game && typeof entry.game === 'object') entries[key.slice(prefix.length)] = entry
        } catch { /* Ignore a malformed entry. */ }
      }
    } catch { /* Retain access to the library when storage is unavailable. */ }
    return entries
  }
  let collection = collections.get(system)
  if (!collection) { collection = shallowRef(read()); collections.set(system, collection) }
  const state = collection
  function save(key: string, game: T, favorite = state.value[key]?.favorite ?? false) {
    const entry = { game, favorite }
    const serialized = JSON.stringify(entry)
    if (serialized === JSON.stringify(state.value[key])) return
    state.value = { ...state.value, [key]: entry }
    try { storage()?.setItem(prefix + key, serialized) } catch { /* Keep the current session usable. */ }
  }
  function reload() { state.value = read() }
  function refresh(event: StorageEvent) {
    if (!event.key || event.key.startsWith(prefix)) reload()
  }
  onMounted(() => window.addEventListener('storage', refresh))
  onBeforeUnmount(() => window.removeEventListener('storage', refresh))
  return {
    games: computed(() => Object.values(state.value).map(entry => entry.game as T)),
    isFavorite: (key: string) => state.value[key]?.favorite ?? false,
    remember: (key: string, game: T) => save(key, game),
    toggleFavorite: (key: string, game: T) => save(key, game, !state.value[key]?.favorite),
    reload,
  }
}
