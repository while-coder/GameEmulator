import { computed, onBeforeUnmount, readonly, ref, shallowRef } from 'vue'
import { findCachedCatalogGame, findCatalogGame, loadCatalogs, readCachedArcadeCatalogs, type CatalogGame } from '../../../arcade/src/store/catalog'
import { prepareCatalogGame } from '../../../arcade/src/store/dependencies'
import { listArchiveSummaries, removeArchive } from '../../../arcade/src/store/library'
import { acquireGame, loadCatalog, readCachedConsoleCatalog, listGames, removeGame, type Game } from '../../../console/src/store'
import { systems, type ConsoleSystem } from '../../../console/src/systems'
import { loadRomCatalog, romKey, type RomEntry } from '../../../nes/src/store/romCatalog'
import { deleteCachedRom, listCachedRomSummaries } from '../../../nes/src/store/romLibrary'
import { acquireRomByKey } from '../../../nes/src/store/romResolver'
import { useGameCollection } from '../../../player-ui/useGameCollection'
import { usePlayHistory } from '../../../player-ui/usePlayHistory'
import type { GameSystem } from '../../../shared/playHistory'
import type { RomDetails } from '../../../shared/versionedCatalog'

export const platforms = [
  { value: 'nes', label: '红白机', badge: 'NES / FC' },
  { value: 'arcade', label: '街机', badge: '街机' },
  { value: 'gba', label: 'GB / GBA', badge: 'GB / GBA' },
  { value: 'sfc', label: 'SFC', badge: 'SFC / SNES' },
  { value: 'psp', label: 'PSP', badge: 'PSP' },
] as const
export const onlinePlatforms = platforms.filter(platform => platform.value !== 'psp')

export type LobbyGame = {
  system: GameSystem
  key: string
  name: string
  screenshot?: string
  genre?: string
  publisher?: string
  tags?: string[]
  details?: RomDetails
  groupId?: string
  groupName?: string
  groupDefault?: boolean
  groupDescription?: string
  groupScreenshots?: string[]
  badge: string
  terms: Array<string | undefined>
  local: boolean
  online: boolean
  favorite: boolean
  lastPlayedAt: number
  remember: () => void
  toggleFavorite: () => void
  download?: (signal: AbortSignal, report: (progress: LobbyDownloadProgress) => void) => Promise<void>
  removeCache?: () => Promise<void>
}

export type LobbyDownloadProgress = { received: number; total: number | null; label?: string }

type Metadata = Partial<Pick<RomEntry, 'name' | 'screenshot_url' | 'genre' | 'publisher' | 'tags' | 'aliases'
  | 'group_id' | 'group_name' | 'group_default' | 'group_description' | 'group_screenshots' | 'details' | 'download_url'>>
type LocalGames<T> = { games: T[]; playedAt?: Map<string, number> }
type Catalog<T> = { games: T[]; incomplete?: boolean }

function useSystemLibrary<T extends Metadata>(platform: typeof platforms[number], options: {
  key: (game: T) => string
  title: (game: T) => string
  extraTerms?: (game: T) => Array<string | undefined>
  loadLocal: () => Promise<LocalGames<T>>
  download: (game: T, signal: AbortSignal, report: (progress: LobbyDownloadProgress) => void) => Promise<void>
  removeCache: (game: T) => Promise<void>
  loadOnline?: (signal: AbortSignal, force: boolean) => Promise<Catalog<T>>
  readOnlineCache?: () => Promise<T[] | undefined>
}) {
  const system = platform.value
  const collection = useGameCollection<T>(system)
  const { history, reload } = usePlayHistory(system)
  const local = shallowRef<LocalGames<T>>({ games: [] })
  const online = shallowRef<T[]>([])
  const loading = ref(false)
  const localLoading = ref(false)
  const failed = ref(false)
  let pending: AbortController | undefined
  let disposed = false

  async function refreshLocal() {
    localLoading.value = true
    collection.reload()
    reload()
    try {
      const games = await options.loadLocal()
      if (!disposed) local.value = games
    } catch { if (!disposed) failed.value = true }
    finally { if (!disposed) localLoading.value = false }
  }

  async function load(force = false) {
    if (pending) return
    const controller = new AbortController()
    pending = controller
    loading.value = true
    failed.value = false
    const fail = () => { if (!disposed) failed.value = true }
    const localRequest = refreshLocal()
    const catalogRequest = (async () => {
      if (!options.loadOnline) return
      if (!force && options.readOnlineCache) {
        const cached = await options.readOnlineCache().catch(() => undefined)
        controller.signal.throwIfAborted()
        if (cached !== undefined) online.value = cached
      }
      const result = await options.loadOnline(controller.signal, force)
      if (disposed) return
      online.value = result.incomplete
        ? [...new Map([...online.value, ...result.games].map(game => [options.key(game), game])).values()]
        : result.games
      if (result.incomplete) fail()
    })().catch(fail)
    await Promise.all([localRequest, catalogRequest])
    if (!disposed) loading.value = false
    pending = undefined
  }
  onBeforeUnmount(() => { disposed = true; pending?.abort() })

  const games = computed<LobbyGame[]>(() => {
    const localGames = new Map(local.value.games.map(game => [options.key(game), game]))
    const onlineKeys = new Set(online.value.map(options.key))
    const known = new Map<string, T>()
    // Keep catalog positions stable when a game is downloaded or remembered.
    for (const game of [...online.value, ...collection.games.value, ...localGames.values()]) {
      const key = options.key(game)
      if (key && !known.has(key) && (localGames.has(key) || game.download_url)) known.set(key, game)
    }
    return [...known].map(([key, game]) => ({
      key,
      system,
      name: options.title(game),
      screenshot: game.screenshot_url,
      genre: game.genre,
      publisher: game.publisher,
      tags: game.tags,
      details: game.details,
      groupId: game.group_id,
      groupName: game.group_name,
      groupDefault: game.group_default,
      groupDescription: game.group_description,
      groupScreenshots: game.group_screenshots,
      badge: platform.badge,
      terms: [options.title(game), game.details?.version, platform.label, platform.badge, game.genre, game.publisher,
        ...(game.tags ?? []), ...(game.aliases ?? []), ...(options.extraTerms?.(game) ?? [])],
      local: localGames.has(key),
      online: onlineKeys.has(key),
      favorite: collection.isFavorite(key),
      lastPlayedAt: history.value[key]?.lastPlayedAt ?? local.value.playedAt?.get(key) ?? 0,
      remember: () => collection.remember(key, game),
      toggleFavorite: () => collection.toggleFavorite(key, game),
      download: game.download_url && !localGames.has(key) ? async (signal, report) => {
        collection.remember(key, game)
        try { await options.download(game, signal, report) }
        finally { await refreshLocal() }
      } : undefined,
      removeCache: localGames.has(key) ? async () => {
        await options.removeCache(localGames.get(key)!)
        await refreshLocal()
      } : undefined,
    }))
  })
  const hasOnlineCatalog = computed(() => online.value.length > 0)
  return { games, load, refreshLocal, loading: readonly(loading), localLoading: readonly(localLoading), failed: readonly(failed), hasOnlineCatalog, platform }
}

function useConsoleLibrary(system: ConsoleSystem, platform: typeof platforms[number]) {
  const source = systems[system].catalogUrl
  return useSystemLibrary<Game>(platform, {
    key: game => game.hash,
    title: game => game.name,
    extraTerms: game => [game.fileName],
    readOnlineCache: source ? () => readCachedConsoleCatalog(system, source) : undefined,
    loadLocal: async () => ({ games: (await listGames(system)).map(({ file: _, ...game }) => game) }),
    download: async (game, signal, report) => {
      await acquireGame(system, game, signal, (received, total) => report({ received, total }))
    },
    removeCache: game => removeGame(system, game.hash),
    loadOnline: source ? async signal => ({ games: await loadCatalog(system, source, signal) }) : undefined,
  })
}

export function useLobbyLibrary() {
  const nes = useSystemLibrary<RomEntry>(platforms[0], {
    key: romKey,
    title: game => game.name,
    loadLocal: async () => {
      const roms = await listCachedRomSummaries()
      return {
        games: roms.map(({ key, name, screenshot_url, genre, publisher, tags, size, aliases, group_id, group_name,
          group_default, group_description, group_screenshots, details }) => ({
          sha256: key, name, screenshot_url, genre, publisher, tags, download_url: '', file_size: size,
          aliases, group_id, group_name, group_default, group_description, group_screenshots, details,
        })),
        playedAt: new Map(roms.map(rom => [rom.key, rom.lastPlayedAt ?? 0])),
      }
    },
    loadOnline: signal => loadRomCatalog(undefined, { signal }),
    download: async (game, signal, onProgress) => {
      if (!await acquireRomByKey(romKey(game), { signal, onProgress }, game)) throw new Error('找不到游戏文件')
    },
    removeCache: game => deleteCachedRom(romKey(game)),
  })
  const arcade = useSystemLibrary<CatalogGame>(platforms[1], {
    key: game => game.sha256?.toLowerCase(),
    title: game => game.name || game.name_en || game.file_name,
    extraTerms: game => [game.name_en, game.file_name, game.system],
    loadLocal: async () => ({
      games: (await listArchiveSummaries()).filter(game => game.kind === 'game').map(game => ({
        name: game.displayName || game.name.replace(/\.zip$/i, ''),
        sha256: game.hash,
        file_name: game.name,
        file_size: game.size,
        rom_name: game.name.replace(/\.zip$/i, ''),
        download_url: '',
        dependencies: game.dependencies,
      })),
    }),
    readOnlineCache: async () => (await readCachedArcadeCatalogs()).flatMap(catalog => catalog.games),
    loadOnline: async (signal, force) => {
      const { catalogs, errors } = await loadCatalogs(signal, force)
      return { games: catalogs.flatMap(catalog => catalog.games), incomplete: !!errors.length }
    },
    download: async (game, signal, report) => {
      const key = game.sha256.toLowerCase()
      const match = await findCachedCatalogGame(key) ?? await findCatalogGame(key, signal)
      signal.throwIfAborted()
      if (!match) throw new Error('找不到游戏目录和依赖，请刷新游戏库后重试')
      await prepareCatalogGame(match.game, match.catalog, {
        signal,
        onProgress: ({ name, received, total }) => report({ label: name, received, total }),
      })
    },
    removeCache: async game => {
      const archive = (await listArchiveSummaries()).find(item => item.kind === 'game' && item.hash === game.sha256)
      if (archive) await removeArchive(archive.id)
    },
  })
  const sources = [nes, arcade, useConsoleLibrary('gba', platforms[2]), useConsoleLibrary('sfc', platforms[3]), useConsoleLibrary('psp', platforms[4])]
  const games = computed(() => sources.flatMap(source => source.games.value))
  return { sources, games }
}
