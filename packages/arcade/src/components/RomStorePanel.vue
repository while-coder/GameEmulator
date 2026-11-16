<script setup lang="ts">
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dependencyPlan, loadCatalogs, type ArcadeCatalog, type CatalogGame } from '../store/catalog'
import type { Archive } from '../store/library'
import type { DependencyProgress } from '../store/dependencies'
import RemoteSelect from '../../../player-ui/RemoteSelect.vue'
import GamePreview from '../../../player-ui/GamePreview.vue'
import GameCardActions from '../../../player-ui/GameCardActions.vue'
import LibraryTabs from '../../../player-ui/LibraryTabs.vue'
import LibraryRequestStatus from '../../../player-ui/LibraryRequestStatus.vue'
import LibraryLoading from '../../../player-ui/LibraryLoading.vue'
import { useLibraryOperation } from '../../../player-ui/useLibraryOperation'
import { useLibraryBrowser, type LibrarySortMode as SortMode } from '../../../player-ui/useLibraryBrowser'
import { libraryFailureReason } from '../../../player-ui/libraryRequest'
import { useGameCollection } from '../../../player-ui/useGameCollection'
import { usePlayHistory } from '../../../player-ui/usePlayHistory'
import { formatPlayTime, sortRecentlyPlayed } from '../../../shared/playHistory'

type RomEntry = CatalogGame & { local?: Archive; catalog?: ArcadeCatalog }
const props = defineProps<{
  active?: boolean
  archives: Archive[]
  busy: boolean
  progress: DependencyProgress | null
  play: (game: CatalogGame, catalog: ArcadeCatalog, signal: AbortSignal) => Promise<void>
  download: (game: CatalogGame, catalog: ArcadeCatalog, signal: AbortSignal) => Promise<void>
  playCached: (game: Archive, signal: AbortSignal) => Promise<void>
  remove: (game: Archive) => Promise<void>
  refresh: () => Promise<void>
}>()
const catalogs = ref<ArcadeCatalog[]>([])
const catalogLoading = ref(false)
const error = ref('')
const actionError = ref('')
const partialRefresh = ref(false)
const refreshVersion = ref(0)
const catalogSnapshots = new Map<string, ArcadeCatalog>()
const libraryTab = ref<'online' | 'played' | 'favorites'>('online')
const { query, genre, sort, page, gameList } = useLibraryBrowser('arcade', libraryTab)
const { games: rememberedGames, isFavorite, remember, toggleFavorite } = useGameCollection<CatalogGame>('arcade')
function metadata(game: RomEntry): CatalogGame {
  const { local, catalog, ...entry } = game
  return entry
}
const busyKey = ref<string | null>(null)
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
defineExpose({ cancelOperation })
const abort = new AbortController()
onBeforeUnmount(() => abort.abort())
onMounted(refreshCatalog)
async function refreshCatalog(force = false) {
  if (catalogLoading.value) return
  catalogLoading.value = true
  error.value = ''
  partialRefresh.value = false
  if (force) actionError.value = ''
  try {
    const result = await loadCatalogs(abort.signal, force)
    for (const [url, catalog] of Object.entries(result.bySource)) catalogSnapshots.set(url, catalog)
    catalogs.value = [...catalogSnapshots.values()]
    error.value = result.errors.length ? libraryFailureReason(result.errors.join('；')) : ''
    partialRefresh.value = result.fresh > 0 && result.errors.length > 0
    if (force) {
      try { await props.refresh() }
      catch { actionError.value = '下载状态暂时无法更新，请稍后重试' }
      if (!error.value && !actionError.value) refreshVersion.value++
    }
  } catch (err) {
    if (!abort.signal.aborted) error.value = libraryFailureReason(err)
  } finally { catalogLoading.value = false }
}
const romKey = (game: CatalogGame) => game.sha256.toLowerCase()
const cachedRoms = computed(() => props.archives.filter(a => a.kind === 'game'))
const libraryGames = computed(() => {
  const games = new Map<string, RomEntry>()
  for (const catalog of catalogs.value) for (const game of catalog.games) {
    if (!games.has(romKey(game))) games.set(romKey(game), { ...game, catalog })
  }
  for (const game of rememberedGames.value) if (!games.has(romKey(game))) games.set(romKey(game), game)
  for (const local of cachedRoms.value) {
    const existing = games.get(local.hash)
    if (existing) existing.local = local
    else games.set(local.hash, {
      name: local.displayName || local.name.replace(/\.zip$/i, ''), rom_name: local.name.replace(/\.zip$/i, ''), file_name: local.name,
      sha256: local.hash, file_size: local.size, download_url: '', dependencies: local.dependencies, local,
    })
  }
  return [...games.values()]
})
const cachedKeys = computed(() => new Set(libraryGames.value.filter(game => {
  if (!game.local) return false
  if (!game.catalog) return true
  return dependencyPlan(game, game.catalog).every(entry => props.archives.some(a => a.hash === entry.sha256 && a.size === entry.file_size))
}).map(romKey)))
const genreOptions = computed(() => [
  { value: '', label: '全部类型' },
  ...[...new Set(libraryGames.value.map(g => g.genre).filter((g): g is string => !!g))].sort().map(value => ({ value, label: value })),
])
const { history } = usePlayHistory('arcade')
const played = (game: RomEntry) => !!history.value[romKey(game)]?.lastPlayedAt
const inMyGames = (game: RomEntry) => played(game) || cachedKeys.value.has(romKey(game))
const tabCounts = computed(() => ({ online: libraryGames.value.length, played: libraryGames.value.filter(inMyGames).length, favorites: libraryGames.value.filter(game => isFavorite(romKey(game))).length }))
watch([catalogs, () => props.archives, history], () => {
  for (const game of libraryGames.value) if (played(game) || isFavorite(romKey(game))) remember(romKey(game), metadata(game))
})
const emptyDescription = computed(() => query.value || genre.value ? '没有匹配的游戏' : libraryTab.value === 'played' ? '还没有游戏，下载或开始游戏后会显示在这里' : libraryTab.value === 'favorites' ? '还没有收藏，右键或长按游戏即可收藏' : catalogLoading.value ? '正在加载游戏目录…' : '暂无游戏')

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认排序' }, { value: 'recent', label: '最近游玩' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' }, { value: 'size-asc', label: '体积 小→大' },
  { value: 'size-desc', label: '体积 大→小' }, { value: 'publisher', label: '按厂商' },
]
const PAGE_SIZE = 50
const sortedMatched = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  const games = libraryGames.value.filter(game =>
    (libraryTab.value === 'online' || (libraryTab.value === 'played' ? inMyGames(game) : isFavorite(romKey(game)))) &&
    (!genre.value || game.genre === genre.value) &&
    (!q || [game.name, game.name_en, game.file_name, game.genre, game.publisher, game.system, ...(game.tags ?? [])].join(' ').toLocaleLowerCase().includes(q)),
  )
  const name = (g: RomEntry) => g.name || g.file_name
  if (sort.value === 'recent') return sortRecentlyPlayed(games, romKey, history.value)
  switch (sort.value) {
    case 'name-asc': return games.sort((a, b) => name(a).localeCompare(name(b), 'zh-Hans-CN'))
    case 'name-desc': return games.sort((a, b) => name(b).localeCompare(name(a), 'zh-Hans-CN'))
    case 'size-asc': return games.sort((a, b) => a.file_size - b.file_size)
    case 'size-desc': return games.sort((a, b) => b.file_size - a.file_size)
    case 'publisher': return games.sort((a, b) => (a.publisher ?? '').localeCompare(b.publisher ?? '', 'zh-Hans-CN') || name(a).localeCompare(name(b)))
    default: return games
  }
})
const totalCount = computed(() => sortedMatched.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
const pageStart = computed(() => (page.value - 1) * PAGE_SIZE)
const pageEnd = computed(() => Math.min(pageStart.value + PAGE_SIZE, totalCount.value))
const visibleGames = computed(() => sortedMatched.value.slice(pageStart.value, pageEnd.value))
watch([libraryTab, totalPages], ([, value]) => { if (page.value > value) page.value = value })
function goPage(target: number) { page.value = Math.max(1, Math.min(target, totalPages.value)) }
async function act(game: RomEntry, action: (signal: AbortSignal) => Promise<void>, kind?: 'play' | 'download') {
  if (props.busy || busyKey.value) return
  busyKey.value = romKey(game)
  actionError.value = ''
  try {
    if (kind) await runOperation(game.name || game.file_name, kind, action)
    else await action(abort.signal)
  } catch (err) { actionError.value = err instanceof Error ? err.message : String(err) } finally { busyKey.value = null }
}
async function play(game: RomEntry) {
  remember(romKey(game), metadata(game))
  await act(game, async signal => {
    if (game.catalog) await props.play(game, game.catalog, signal)
    else if (game.local) await props.playCached(game.local, signal)
    else {
      const source = await catalogSource(game, signal)
      signal.throwIfAborted()
      await props.play(source.entry, source.catalog, signal)
    }
  }, 'play')
}
async function download(game: RomEntry) {
  remember(romKey(game), metadata(game))
  await act(game, async signal => {
    const source = await catalogSource(game, signal)
    signal.throwIfAborted()
    await props.download(source.entry, source.catalog, signal)
  }, 'download')
}
async function catalogSource(game: RomEntry, signal: AbortSignal) {
  signal.throwIfAborted()
  if (game.catalog) return { entry: game, catalog: game.catalog }
  const result = await loadCatalogs(signal)
  signal.throwIfAborted()
  const catalog = result.catalogs.find(item => item.games.some(entry => romKey(entry) === romKey(game)))
  const entry = catalog?.games.find(entry => romKey(entry) === romKey(game))
  if (!catalog || !entry) throw new Error('暂时无法获取此游戏的下载信息，请联网刷新目录后重试')
  return { entry, catalog }
}
async function removeCached(game: RomEntry) {
  if (game.local) await act(game, () => props.remove(game.local!))
}
const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const metaLine = (game: RomEntry) => [game.system, game.genre, game.publisher, formatSize(game.file_size)].filter(Boolean).join(' · ')
</script>

<template>
  <section class="store-panel player-library">
      <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :message="progress ? '正在下载并校验游戏…' : undefined" :progress="progress ? { ...progress, label: progress.name } : null" :cancelling="cancelling" @cancel="cancelOperation" />
      <LibraryTabs v-model="libraryTab" panel-id="arcade-library-games" :counts="tabCounts" />
      <div class="store-tools">
        <div class="search-tools">
          <SInput v-model:value="query" class="search" type="search" placeholder="搜索游戏、厂商、标签" aria-label="搜索街机游戏" />
          <button type="button" class="library-refresh" :title="catalogLoading ? '正在刷新游戏库…' : '刷新游戏库'" :aria-label="catalogLoading ? '正在刷新游戏库' : '刷新游戏库'" :aria-busy="catalogLoading" :disabled="catalogLoading || busy || busyKey !== null" @click="refreshCatalog(true)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'is-refreshing': catalogLoading }" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
          </button>
        </div>
        <RemoteSelect v-model="genre" class="select" :options="genreOptions" aria-label="游戏类型" />
        <RemoteSelect v-model="sort" class="select" :options="SORT_OPTIONS" aria-label="游戏排序" />
      </div>

      <LibraryRequestStatus :loading="catalogLoading" :has-games="libraryGames.length > 0" :has-catalog="catalogs.length > 0" :has-downloads="cachedKeys.size > 0" :failed="!!error" :partial="partialRefresh" :reason="error" :success-version="refreshVersion" :disabled="busy || busyKey !== null" @retry="refreshCatalog(true)" />

      <p v-if="actionError" class="library-action-error" role="alert">{{ actionError }}</p>
      <div id="arcade-library-games" ref="gameList" class="game-list" data-nav-grid role="tabpanel" :aria-labelledby="`arcade-library-games-${libraryTab}`">
        <article
          v-for="game in visibleGames"
          :key="romKey(game)"
          class="game-card"
          data-nav-cell
        >
          <GameCardActions :name="game.name || game.file_name" :detail="metaLine(game)" :disabled="busy || busyKey !== null" :busy="busyKey === romKey(game)" :can-remove="!!game.local" :can-download="!cachedKeys.has(romKey(game)) && !!game.download_url" :favorite="isFavorite(romKey(game))" @play="play(game)" @download="download(game)" @favorite="toggleFavorite(romKey(game), metadata(game))" @remove="removeCached(game)" />
          <span v-if="isFavorite(romKey(game))" class="game-favorite-mark" aria-label="已收藏">★</span>
          <GamePreview :game-key="romKey(game)" :name="game.name || game.file_name" :system="game.system || 'ARCADE'" :screenshot="game.screenshot_url">
            <STag v-if="cachedKeys.has(romKey(game))" size="small" type="success">已下载</STag>
          </GamePreview>
          <div class="game-main">
            <div class="game-title-row">
              <h3>{{ game.name || game.file_name }}</h3>

            </div>
            <p v-if="game.genre || history[romKey(game)]?.totalPlayTimeMs" class="meta game-play-meta">
              <span>{{ game.genre }}</span>
              <span v-if="history[romKey(game)]?.totalPlayTimeMs" class="play-time">已玩 {{ formatPlayTime(history[romKey(game)].totalPlayTimeMs) }}</span>
            </p>

          </div>

        </article>

        <SEmpty v-if="visibleGames.length === 0 && !(libraryTab === 'online' && (catalogLoading || error) && libraryGames.length === 0)" class="empty" :description="emptyDescription" />
      </div>

      <div class="store-pager">
        <span class="library-count" aria-live="polite">显示 {{ totalCount ? pageStart + 1 : 0 }}–{{ pageEnd }} / 共 {{ totalCount }} 款</span>
        <nav v-if="totalPages > 1" class="pager-controls" aria-label="游戏库分页">
          <SButton class="pager-btn" :disabled="page <= 1" @click="goPage(1)">首页</SButton>
          <SButton class="pager-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</SButton>
          <span class="page-info" aria-label="当前页">{{ page }} / {{ totalPages }}</span>
          <SButton class="pager-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</SButton>
          <SButton class="pager-btn" :disabled="page >= totalPages" @click="goPage(totalPages)">尾页</SButton>
        </nav>
      </div>
  </section>
</template>

<style scoped>
.store-panel {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #202328;
  color: #ececec;
}
.store-tools {
  display: grid;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid #30353d;
}
.search,
.select {
  min-width: 0;
  height: 34px;
  border: 1px solid #434a54;
  border-radius: 6px;
  background: #171a1f;
  color: #eee;
  padding: 0 10px;
  font-size: 14px;
}
.check {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #c6ccd5;
  font-size: 13px;
  white-space: nowrap;
}
.store-summary {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px;
  color: #9da5b3;
  font-size: 12px;
  border-bottom: 1px solid #30353d;
}
.error {
  color: #ffb0a6;
  text-align: right;
}
.game-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
  align-content: start;
}
.game-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #333942;
  border-radius: 8px;
  background: #252a31;
}
.game-main {
  min-width: 0;
  flex: 1;
}
.game-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.game-title-row h3 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.cache-state {
  flex: 0 0 auto;
}
.meta {
  margin: 5px 0 0;
  color: #a2aab6;
  font-size: 12px;
  line-height: 1.35;
}
.meta.played {
  color: #8a93a0;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.game-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.progress {
  min-width: 44px;
  color: #d6b36a;
  font-size: 12px;
  text-align: right;
}
.btn {
  height: 32px;
  border: none;
  border-radius: 6px;
  background: #3a3f48;
  color: #eee;
  padding: 0 12px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.btn.primary {
  background: #2f6f9f;
}
.btn:hover:not(:disabled) {
  filter: brightness(1.12);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.empty {
  grid-column: 1 / -1;
  margin: 40px 0;
  color: #9da5b3;
  text-align: center;
}
.store-pager {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 18px;
  background: #202328;
  border-top: 1px solid #30353d;
}
.pager-btn {
  height: 30px;
  min-width: 56px;
  padding: 0 12px;
  border: 1px solid #3a414c;
  border-radius: 6px;
  background: #2a2f37;
  color: #d6dbe2;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.pager-btn:hover:not(:disabled) {
  background: #343b45;
  border-color: #4a525e;
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.page-info {
  min-width: 72px;
  padding: 0 6px;
  color: #c6ccd5;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

@media (max-width: 720px) {
  .store-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .error {
    text-align: left;
  }
  .game-list {
    grid-template-columns: 1fr;
  }
  .game-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

/* 手机横屏:总高 ~360-400px,默认 chrome 会吃掉 ~240px 让列表几乎不可见。
   全屏铺满 + 大幅压缩 header/tools/summary/pager,并把卡片维持在单行(横向 grid)
   再隐藏次要元信息(标签 / 最后使用),让列表区至少 5-6 行可见。 */
@media (orientation: landscape) and (max-height: 540px) {
  .store-tools {
    padding: 6px 12px;
    gap: 6px;
  }
  .search,
  .select {
    height: 28px;
    font-size: 12px;
  }
  .store-summary {
    min-height: 0;
    padding: 3px 12px;
    flex-direction: row;
    align-items: center;
    font-size: 11px;
  }
  .game-list {
    padding: 6px 12px 8px;
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .game-card {
    flex-direction: row;
    align-items: center;
    padding: 6px 8px;
    gap: 8px;
  }
  .game-title-row h3 {
    font-size: 13px;
  }
  .meta {
    margin-top: 2px;
    font-size: 11px;
  }
  .meta.played,
  .tags {
    display: none;
  }
  .game-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
  }
  .btn {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
  .store-pager {
    padding: 4px 12px;
    gap: 4px;
  }
  .pager-btn {
    height: 26px;
    min-width: 44px;
    padding: 0 8px;
    font-size: 12px;
  }
  .page-info {
    min-width: 56px;
    font-size: 12px;
  }
}
</style>

<style scoped>
@media (orientation: landscape) and (max-height: 540px) {
  .store-summary { flex-shrink: 0; }
  .store-pager { padding: 4px 12px; }
  .game-list { grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); }
}
</style>

<style scoped>
@media (pointer: coarse) {
  .store-tools {
    flex-shrink: 0;
    gap: var(--player-control-gap, 8px);
    padding: var(--player-tools-padding, 8px) 12px;
  }
  .store-summary {
    flex-shrink: 0;
    min-height: 24px;
    padding: 4px 12px;
    gap: 4px;
    font-size: 12px;
    line-height: 1.3;
  }
  .game-list { padding: 8px 12px; gap: var(--player-control-gap, 8px); }
  .game-card { padding: var(--player-card-padding, 12px); gap: var(--player-control-gap, 8px); }
  .game-actions { gap: var(--player-control-gap, 8px); }
  .meta { margin-top: 3px; font-size: 12px; line-height: 1.3; }
  .store-pager { gap: var(--player-control-gap, 8px); padding: 4px 12px; }
  .pager-btn { min-width: var(--player-control-height, 44px); padding-inline: 8px; }
  .page-info { min-width: 48px; }
  .tags { margin-top: 4px; gap: 4px; }
}
</style>

<style scoped>
.store-summary { flex-wrap: wrap; }
.game-card { min-width: 0; }
.game-title-row h3 { flex: 1; }
.error { max-width: 100%; overflow-wrap: anywhere; }
.progress { overflow-wrap: anywhere; }
@media (pointer: coarse) {
  .store-panel .game-actions .btn, .store-panel .pager-btn,
  .store-panel .search, .store-panel .select, .store-panel .check { min-height: 44px; }
  .game-actions { flex-wrap: wrap; }
}
</style>
