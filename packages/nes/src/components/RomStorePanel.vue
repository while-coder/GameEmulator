<script setup lang="ts">
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { downloadRom, validateRomBytes, type DownloadProgress } from '../store/romDownloader'
import {
  emptyRomCatalog,
  listGenres,
  loadRomCatalog,
  romKey,
  searchRoms,
  type RomCatalog,
  type RomEntry,
} from '../store/romCatalog'
import {
  deleteCachedRom,
  getCachedRom,
  listCachedRoms,
  saveCachedRom,
  type CachedRom,
} from '../store/romLibrary'
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
import { compareGameNames } from '../../../shared/gameText'

const props = defineProps<{ launch?: (payload: { name: string; bytes: Uint8Array; key: string }, signal?: AbortSignal) => Promise<void> }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  beforePlay: []
  load: [{ name: string; bytes: Uint8Array; key: string }]
}>()

const catalog = ref<RomCatalog>(emptyRomCatalog())
const libraryTab = ref<'online' | 'played' | 'favorites'>('online')
const { query, genre, sort, page, gameList } = useLibraryBrowser('nes', libraryTab)
const cachedRoms = ref<CachedRom[]>([])
const busyKey = ref<string | null>(null)
const catalogLoading = ref(false)
const refreshing = ref(false)
const catalogError = ref('')
const hasCatalog = ref(false)
const refreshVersion = ref(0)
const abort = new AbortController()
onBeforeUnmount(() => abort.abort())
const error = ref<string | null>(null)
const progressByKey = ref<Record<string, DownloadProgress>>({})
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const loadingMessage = ref('')
const loadingProgress = computed(() => busyKey.value ? progressByKey.value[busyKey.value] : null)

const { history } = usePlayHistory('nes')
const { games: rememberedGames, isFavorite, remember, toggleFavorite } = useGameCollection<RomEntry>('nes')

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'recent', label: '最近游玩' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'size-asc', label: '体积 小→大' },
  { value: 'size-desc', label: '体积 大→小' },
  { value: 'publisher', label: '按厂商' },
]

const PAGE_SIZE = 50

function sortList<T>(
  list: T[],
  name: (item: T) => string,
  size: (item: T) => number,
  publisher: (item: T) => string,
): T[] {
  if (sort.value === 'default') return list
  const arr = list.slice()
  switch (sort.value) {
    case 'name-asc':
      return arr.sort((a, b) => compareGameNames(name(a), name(b)))
    case 'name-desc':
      return arr.sort((a, b) => compareGameNames(name(b), name(a)))
    case 'size-asc':
      return arr.sort((a, b) => size(a) - size(b))
    case 'size-desc':
      return arr.sort((a, b) => size(b) - size(a))
    case 'publisher':
      return arr.sort(
        (a, b) =>
          publisher(a).localeCompare(publisher(b), 'zh-Hans-CN') ||
          compareGameNames(name(a), name(b)),
      )
    default:
      return arr
  }
}

const legacyPlayedAt = computed(() => new Map(cachedRoms.value.map(rom => [rom.key, rom.lastPlayedAt ?? 0])))
const cachedKeys = computed(() => new Set(cachedRoms.value.map((rom) => rom.key)))
// 合并在线目录和缓存，缓存中已不在目录里的游戏仍可离线启动。
const libraryGames = computed(() => {
  const games = new Map(catalog.value.games.map(game => [romKey(game), game]))
  for (const game of rememberedGames.value) if (!games.has(romKey(game))) games.set(romKey(game), game)
  for (const rom of cachedRoms.value) {
    if (!games.has(rom.key)) {
      games.set(rom.key, {
        name: rom.name, genre: rom.genre, publisher: rom.publisher,
        mapper: rom.mapper, tags: rom.tags, file_size: rom.size,
        sha256: rom.key, download_url: '', screenshot_url: rom.screenshot_url,
      })
    }
  }
  return [...games.values()]
})
const played = (game: RomEntry) => !!(history.value[romKey(game)]?.lastPlayedAt || legacyPlayedAt.value.get(romKey(game)))
const inMyGames = (game: RomEntry) => played(game) || cachedKeys.value.has(romKey(game))
const tabCounts = computed(() => ({ online: libraryGames.value.length, played: libraryGames.value.filter(inMyGames).length, favorites: libraryGames.value.filter(game => isFavorite(romKey(game))).length }))
const tabGames = computed(() => libraryGames.value.filter(game => libraryTab.value === 'online' || (libraryTab.value === 'played' ? inMyGames(game) : isFavorite(romKey(game)))))
const genres = computed(() => listGenres(libraryGames.value))
const genreOptions = computed(() => [
  { value: '', label: '全部类型' },
  ...genres.value.map((item) => ({ value: item, label: item })),
])
const matchedGames = computed(() =>
  searchRoms(tabGames.value, query.value, genre.value, false, cachedKeys.value),
)
const sortedMatched = computed(() => sort.value === 'recent'
  ? sortRecentlyPlayed(matchedGames.value, romKey, history.value, game => legacyPlayedAt.value.get(romKey(game)) ?? 0)
  : sortList(matchedGames.value, (g) => g.name, (g) => g.file_size ?? 0, (g) => g.publisher ?? ''),
)
const totalCount = computed(() => sortedMatched.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
const pageStart = computed(() => (page.value - 1) * PAGE_SIZE)
const pageEnd = computed(() => Math.min(pageStart.value + PAGE_SIZE, totalCount.value))
const visibleGames = computed(() => sortedMatched.value.slice(pageStart.value, pageStart.value + PAGE_SIZE))
watch([catalog, cachedRoms, history], () => {
  for (const game of libraryGames.value) if (played(game) || isFavorite(romKey(game))) remember(romKey(game), game)
})
const emptyDescription = computed(() => query.value || genre.value ? '没有匹配的游戏' : libraryTab.value === 'played' ? '还没有游戏，下载或开始游戏后会显示在这里' : libraryTab.value === 'favorites' ? '还没有收藏，右键或长按游戏即可收藏' : catalogLoading.value ? '正在加载游戏目录…' : '暂无游戏')

// 列表变短（例如删除后）时收敛当前页，避免停在空页
watch([libraryTab, totalPages], ([, pages]) => {
  if (page.value > pages) page.value = pages
})

function goPage(target: number) {
  page.value = Math.min(Math.max(1, target), totalPages.value)
}

watch(open, (value) => { if (value) void prepareStore() }, { immediate: true })
defineExpose({ busyKey, cancelOperation })

async function prepareStore(manual = false) {
  if (refreshing.value || busyKey.value !== null) return
  refreshing.value = true
  error.value = null
  try {
    await Promise.all([refreshCatalog(), refreshCached()])
    if (manual && !catalogError.value && !error.value) refreshVersion.value++
  }
  finally { refreshing.value = false }
}

async function refreshCatalog() {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    catalog.value = await loadRomCatalog(undefined, { signal: abort.signal })
    hasCatalog.value = true
  } catch (err) {
    if (!abort.signal.aborted) catalogError.value = libraryFailureReason(err)
  } finally {
    catalogLoading.value = false
  }
}

async function refreshCached() {
  try {
    cachedRoms.value = await listCachedRoms()
  } catch (err) {
    error.value = formatError(err)
  }
}

async function play(game: RomEntry) {
  if (busyKey.value !== null) return
  emit('beforePlay')
  const key = romKey(game)
  busyKey.value = key
  error.value = null
  remember(key, game)
  try {
    loadingMessage.value = '正在准备游戏…'
    await runOperation(game.name, 'play', async signal => {
      const bytes = await ensureCached(game, key, signal)
      await refreshCached()
      signal.throwIfAborted()
      clearProgress(key)
      loadingMessage.value = '正在启动游戏…'
      if (props.launch) await props.launch({ name: game.name, bytes, key }, signal)
      else emit('load', { name: game.name, bytes, key })
      signal.throwIfAborted()
      open.value = false
    })
  } catch (err) {
    error.value = formatError(err)
  } finally {
    clearProgress(key)
    busyKey.value = null
  }
}

async function ensureCached(game: RomEntry, key: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const cached = await getCachedRom(key)
  signal.throwIfAborted()
  if (cached) {
    try {
      if (game.download_url) await validateRomBytes(game, cached.bytes)
      signal.throwIfAborted()
      return cached.bytes
    } catch {
      signal.throwIfAborted()
      await deleteCachedRom(key)
    }
  }
  signal.throwIfAborted()
  if (!game.download_url) throw new Error('该游戏缓存已失效，请联网刷新目录后重新下载')
  return downloadAndCache(game, key, signal)
}

async function download(game: RomEntry) {
  if (busyKey.value !== null) return
  const key = romKey(game)
  busyKey.value = key
  error.value = null
  remember(key, game)
  try {
    loadingMessage.value = '正在准备下载…'
    await runOperation(game.name, 'download', async signal => {
      await ensureCached(game, key, signal)
      await refreshCached()
    })
  }
  catch (err) { error.value = formatError(err) }
  finally { clearProgress(key); busyKey.value = null }
}

async function downloadAndCache(game: RomEntry, key: string, signal: AbortSignal): Promise<Uint8Array> {
  loadingMessage.value = '正在下载游戏…'
  const bytes = await downloadRom(game, {
    signal,
    onProgress: (progress) => {
      setProgress(key, progress)
      if (progress.ratio === 1) loadingMessage.value = '正在校验并保存游戏…'
    },
  })
  signal.throwIfAborted()
  await saveCachedRom(game, bytes)
  // A completed, verified download remains available even if launch is cancelled.
  await refreshCached()
  signal.throwIfAborted()
  return bytes
}

async function removeCachedByKey(key: string) {
  if (busyKey.value !== null) return
  busyKey.value = key
  error.value = null
  try {
    await deleteCachedRom(key)
    await refreshCached()
  } catch (err) {
    error.value = formatError(err)
  } finally {
    busyKey.value = null
  }
}

function setProgress(key: string, progress: DownloadProgress) {
  progressByKey.value = { ...progressByKey.value, [key]: progress }
}

function clearProgress(key: string) {
  const next = { ...progressByKey.value }
  delete next[key]
  progressByKey.value = next
}


function metaLine(game: RomEntry): string {
  const parts = [
    game.genre,
    game.publisher,
    game.file_size ? formatSize(game.file_size) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <section class="store-panel player-library">
      <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :message="loadingMessage" :progress="loadingProgress" :cancelling="cancelling" @cancel="cancelOperation" />
      <LibraryTabs v-model="libraryTab" panel-id="nes-library-games" :counts="tabCounts" />
      <div class="store-tools">
        <div class="search-tools">
          <SInput v-model:value="query" class="search" type="search" placeholder="搜索游戏、厂商、标签，支持拼音" aria-label="搜索游戏、厂商、标签，支持拼音全拼、首字母和混输" />
          <button type="button" class="library-refresh" :title="refreshing ? '正在刷新游戏库…' : '刷新游戏库'" :aria-label="refreshing ? '正在刷新游戏库' : '刷新游戏库'" :aria-busy="refreshing" :disabled="refreshing || busyKey !== null" @click="prepareStore(true)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'is-refreshing': refreshing }" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
          </button>
        </div>
        <RemoteSelect v-model="genre" class="select" :options="genreOptions" aria-label="游戏类型" />
        <RemoteSelect v-model="sort" class="select" :options="SORT_OPTIONS" aria-label="游戏排序" />
      </div>

      <LibraryRequestStatus :loading="refreshing" :has-games="libraryGames.length > 0" :has-catalog="hasCatalog" :has-downloads="cachedKeys.size > 0" :failed="!!catalogError" :reason="catalogError" :success-version="refreshVersion" :disabled="busyKey !== null" @retry="prepareStore(true)" />
      <p v-if="error" class="library-action-error" role="alert">{{ error }}</p>

      <div id="nes-library-games" ref="gameList" class="game-list" data-nav-grid role="tabpanel" :aria-labelledby="`nes-library-games-${libraryTab}`">
        <article
          v-for="game in visibleGames"
          :key="romKey(game)"
          class="game-card"
          data-nav-cell
        >
          <GameCardActions :name="game.name" :detail="metaLine(game)" :disabled="busyKey !== null" :busy="busyKey === romKey(game)" :can-remove="cachedKeys.has(romKey(game))" :can-download="!cachedKeys.has(romKey(game)) && !!game.download_url" :favorite="isFavorite(romKey(game))" @play="play(game)" @download="download(game)" @favorite="toggleFavorite(romKey(game), game)" @remove="removeCachedByKey(romKey(game))" />
          <span v-if="isFavorite(romKey(game))" class="game-favorite-mark" aria-label="已收藏">★</span>
          <GamePreview :game-key="romKey(game)" :name="game.name" :screenshot="game.screenshot_url">
            <STag v-if="cachedKeys.has(romKey(game))" size="small" type="success">已下载</STag>
          </GamePreview>
          <div class="game-main">
            <div class="game-title-row">
              <h3>{{ game.name }}</h3>

            </div>
            <p v-if="game.genre || history[romKey(game)]?.totalPlayTimeMs" class="meta game-play-meta">
              <span>{{ game.genre }}</span>
              <span v-if="history[romKey(game)]?.totalPlayTimeMs" class="play-time">已玩 {{ formatPlayTime(history[romKey(game)].totalPlayTimeMs) }}</span>
            </p>

          </div>

        </article>

        <SEmpty v-if="visibleGames.length === 0 && !(libraryTab === 'online' && (refreshing || catalogError) && libraryGames.length === 0)" class="empty" :description="emptyDescription" />
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
.search-tools { display: flex; align-items: center; gap: 8px; min-width: 0; }
.search-tools > :deep(.s-input-wrap) { flex: 1; min-width: 0; }
.search-tools .search { width: 100%; }
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
    gap: var(--player-control-gap);
    padding: var(--player-tools-padding) 12px;
  }
  .store-summary {
    flex-shrink: 0;
    min-height: 24px;
    padding: 4px 12px;
    gap: 4px;
    font-size: 12px;
    line-height: 1.3;
  }
  .game-list { padding: 8px 12px; gap: var(--player-control-gap); }
  .game-card { padding: var(--player-card-padding); gap: var(--player-control-gap); }
  .game-actions { gap: var(--player-control-gap); }
  .meta { margin-top: 3px; font-size: 12px; line-height: 1.3; }
  .store-pager { gap: var(--player-control-gap); padding: 4px 12px; }
  .pager-btn { min-width: var(--player-control-height); padding-inline: 8px; }
  .page-info { min-width: 48px; }
  .tags { margin-top: 4px; gap: 4px; }
}
</style>
