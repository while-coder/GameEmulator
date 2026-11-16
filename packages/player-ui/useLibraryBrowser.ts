import { computed, ref, watch, type Ref } from 'vue'
import type { GameSystem } from '../shared/playHistory'

type LibraryTab = 'online' | 'played' | 'favorites'
const SORT_MODES = ['recent', 'default', 'name-asc', 'name-desc', 'size-asc', 'size-desc', 'publisher'] as const
export type LibrarySortMode = typeof SORT_MODES[number]
type BrowseState = { query: string; genre: string; sort: LibrarySortMode; page: number; scrollTop: number }

export function useLibraryBrowser(system: GameSystem, tab: Ref<LibraryTab>) {
  const sortKey = (id: LibraryTab) => `game-emulator:library-sort:${system}:${id}`
  function initial(id: LibraryTab, sort: LibrarySortMode): BrowseState {
    try {
      const saved = localStorage.getItem(sortKey(id))
      if (SORT_MODES.includes(saved as LibrarySortMode)) sort = saved as LibrarySortMode
    } catch { /* Use defaults when local storage is unavailable. */ }
    return { query: '', genre: '', sort, page: 1, scrollTop: 0 }
  }
  const states = ref<Record<LibraryTab, BrowseState>>({
    online: initial('online', 'default'), played: initial('played', 'recent'), favorites: initial('favorites', 'default'),
  })
  const gameList = ref<HTMLElement | null>(null)
  const current = computed(() => states.value[tab.value])
  function resetScroll() {
    current.value.scrollTop = 0
    if (gameList.value) gameList.value.scrollTop = 0
  }
  function filter<K extends 'query' | 'genre' | 'sort'>(key: K) {
    return computed({
      get: () => current.value[key],
      set: (value: BrowseState[K]) => {
        if (current.value[key] === value) return
        current.value[key] = value
        if (key === 'sort') {
          try { localStorage.setItem(sortKey(tab.value), String(value)) }
          catch { /* Retain the selection for this session. */ }
        }
        current.value.page = 1
        resetScroll()
      },
    })
  }
  const page = computed({
    get: () => current.value.page,
    set: (value: number) => { current.value.page = value; resetScroll() },
  })
  // Save before Vue replaces the outgoing list; restore after the new page renders.
  watch(tab, (_next, previous) => {
    if (gameList.value) states.value[previous].scrollTop = gameList.value.scrollTop
  }, { flush: 'sync' })
  watch(tab, () => {
    if (gameList.value) gameList.value.scrollTop = current.value.scrollTop
  }, { flush: 'post' })
  return { query: filter('query'), genre: filter('genre'), sort: filter('sort'), page, gameList }
}
