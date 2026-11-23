import { onlinePlatforms } from './useLobbyLibrary'

export type LobbyTab = 'mine' | 'favorites' | typeof onlinePlatforms[number]['value']
export const densityOptions = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '标准' },
  { value: 'large', label: '大卡片' },
  { value: 'extra-large', label: '超大卡片' },
] as const
export type LobbyPreferences = { tab: LobbyTab; sort: 'default' | 'name' | 'recent'; density: typeof densityOptions[number]['value'] }
export type LobbyState = {
  tab: LobbyTab
  page: number
  searchOpen: boolean
  searchQuery: string
  searchPage: number
  browseScroll: number
  browseBeforeSettings: number
  settingsOpen: boolean
  focus: string
  scroll: number
}
const preferencesKey = 'game-emulator:lobby-preferences'
const returnKey = 'game-emulator:lobby-return'

function readTab(value: unknown): LobbyTab {
  if (value === 'favorites') return 'favorites'
  return onlinePlatforms.find(platform => platform.value === value)?.value ?? 'mine'
}

export function loadPreferences(): LobbyPreferences {
  let stored: (Partial<LobbyPreferences> & { platform?: unknown }) | null = null
  try { stored = JSON.parse(localStorage.getItem(preferencesKey) ?? localStorage.getItem('game-emulator:tv:lobby-preferences') ?? 'null') } catch { /* Use defaults. */ }
  return {
    tab: readTab(stored?.tab ?? stored?.platform),
    sort: stored?.sort === 'name' || stored?.sort === 'recent' ? stored.sort : 'default',
    density: densityOptions.find(option => option.value === stored?.density)?.value ?? 'comfortable',
  }
}

export function savePreferences(value: LobbyPreferences) {
  try { localStorage.setItem(preferencesKey, JSON.stringify(value)) } catch { /* Use the current session preferences. */ }
}

export function readLobbyReturn(): LobbyState | undefined {
  try {
    const stored = sessionStorage.getItem(returnKey)
    sessionStorage.removeItem(returnKey)
    if (!stored) return
    const value = JSON.parse(stored) as LobbyState & { platform?: unknown; favorites?: boolean }
    const page = (value: number) => Number.isSafeInteger(value) && value > 0 ? value : 1
    const scroll = (value: number) => Number.isFinite(value) && value > 0 ? value : 0
    return {
      tab: readTab(value.tab ?? (value.favorites ? 'favorites' : value.platform)), page: page(value.page),
      searchOpen: value.searchOpen === true,
      searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery : '', searchPage: page(value.searchPage),
      browseScroll: scroll(value.browseScroll), browseBeforeSettings: scroll(value.browseBeforeSettings), settingsOpen: value.settingsOpen === true,
      focus: typeof value.focus === 'string' ? value.focus : '', scroll: scroll(value.scroll),
    }
  } catch { /* A fresh lobby does not require storage. */ }
}

export function saveLobbyReturn(value: LobbyState) {
  try { sessionStorage.setItem(returnKey, JSON.stringify(value)) } catch { /* Returning still opens the lobby. */ }
}
