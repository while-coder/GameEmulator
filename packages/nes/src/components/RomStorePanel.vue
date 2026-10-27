<script setup lang="ts">
import SCheckbox from '@qingfeng346/ui-kit/components/checkbox/SCheckbox.vue'
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, ref, watch } from 'vue'
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
  touchCachedRom,
  type CachedRom,
} from '../store/romLibrary'
import RemoteSelect from './RemoteSelect.vue'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  load: [{ name: string; bytes: Uint8Array; key: string }]
}>()

const catalog = ref<RomCatalog>(emptyRomCatalog())
const query = ref('')
const genre = ref('')
const downloadedOnly = ref(false)
const cachedRoms = ref<CachedRom[]>([])
const busyKey = ref<string | null>(null)
const catalogLoading = ref(false)
const error = ref<string | null>(null)
const progressByKey = ref<Record<string, DownloadProgress>>({})

type SortMode = 'default' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' | 'publisher'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'size-asc', label: '体积 小→大' },
  { value: 'size-desc', label: '体积 大→小' },
  { value: 'publisher', label: '按厂商' },
]

const PAGE_SIZE = 60
const page = ref(1)
const sort = ref<SortMode>('default')

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
      return arr.sort((a, b) => name(a).localeCompare(name(b), 'zh-Hans-CN'))
    case 'name-desc':
      return arr.sort((a, b) => name(b).localeCompare(name(a), 'zh-Hans-CN'))
    case 'size-asc':
      return arr.sort((a, b) => size(a) - size(b))
    case 'size-desc':
      return arr.sort((a, b) => size(b) - size(a))
    case 'publisher':
      return arr.sort(
        (a, b) =>
          publisher(a).localeCompare(publisher(b), 'zh-Hans-CN') ||
          name(a).localeCompare(name(b), 'zh-Hans-CN'),
      )
    default:
      return arr
  }
}

const cachedKeys = computed(() => new Set(cachedRoms.value.map((rom) => rom.key)))
// 合并在线目录和缓存，缓存中已不在目录里的游戏仍可离线启动。
const libraryGames = computed(() => {
  const games = new Map(catalog.value.games.map((game) => [romKey(game), game]))
  for (const rom of cachedRoms.value) {
    if (!games.has(rom.key)) {
      games.set(rom.key, {
        name: rom.name, genre: rom.genre, publisher: rom.publisher,
        mapper: rom.mapper, tags: rom.tags, file_size: rom.size,
        sha256: rom.key, download_url: '',
      })
    }
  }
  return [...games.values()]
})
const genres = computed(() => listGenres(libraryGames.value))
const genreOptions = computed(() => [
  { value: '', label: '全部类型' },
  ...genres.value.map((item) => ({ value: item, label: item })),
])
const matchedGames = computed(() =>
  searchRoms(libraryGames.value, query.value, genre.value, downloadedOnly.value, cachedKeys.value),
)
const sortedMatched = computed(() =>
  sortList(matchedGames.value, (g) => g.name, (g) => g.file_size ?? 0, (g) => g.publisher ?? ''),
)
const totalCount = computed(() => sortedMatched.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
const pageStart = computed(() => (page.value - 1) * PAGE_SIZE)
const pageEnd = computed(() => Math.min(pageStart.value + PAGE_SIZE, totalCount.value))
const visibleGames = computed(() => sortedMatched.value.slice(pageStart.value, pageStart.value + PAGE_SIZE))
watch([query, genre, sort, downloadedOnly], () => { page.value = 1 })

// 列表变短（例如删除后）时收敛当前页，避免停在空页
watch(totalPages, (pages) => {
  if (page.value > pages) page.value = pages
})

function goPage(target: number) {
  page.value = Math.min(Math.max(1, target), totalPages.value)
}

watch(open, (value) => { if (value) void prepareStore() }, { immediate: true })
defineExpose({ busyKey })

async function prepareStore() {
  await Promise.all([refreshCatalog(), refreshCached()])
}

async function refreshCatalog() {
  catalogLoading.value = true
  error.value = null
  try {
    catalog.value = await loadRomCatalog()
  } catch (err) {
    error.value = formatError(err)
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
  const key = romKey(game)
  busyKey.value = key
  error.value = null
  try {
    let bytes: Uint8Array | null = null
    const cached = await getCachedRom(key)
    if (cached) {
      try {
        if (game.download_url) await validateRomBytes(game, cached.bytes)
        bytes = cached.bytes
      } catch {
        await deleteCachedRom(key)
      }
    }
    if (!bytes) {
      if (!game.download_url) throw new Error('该 ROM 缓存已失效，请重新添加游戏')
      bytes = await downloadAndCache(game, key)
    }
    await touchCachedRom(key)
    await refreshCached()
    emit('load', { name: game.name, bytes, key })
    open.value = false
  } catch (err) {
    error.value = formatError(err)
  } finally {
    clearProgress(key)
    busyKey.value = null
  }
}

async function downloadOnly(game: RomEntry) {
  if (busyKey.value !== null) return
  const key = romKey(game)
  if (cachedKeys.value.has(key)) return
  busyKey.value = key
  error.value = null
  try {
    await downloadAndCache(game, key)
    await refreshCached()
  } catch (err) {
    error.value = formatError(err)
  } finally {
    clearProgress(key)
    busyKey.value = null
  }
}

async function downloadAndCache(game: RomEntry, key = romKey(game)): Promise<Uint8Array> {
  const bytes = await downloadRom(game, {
    onProgress: (progress) => setProgress(key, progress),
  })
  await saveCachedRom(game, bytes)
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

function progressLabel(game: RomEntry): string {
  const progress = progressByKey.value[romKey(game)]
  if (!progress) return ''
  if (progress.ratio !== null) return `${Math.round(progress.ratio * 100)}%`
  return formatSize(progress.received)
}

function playLabel(game: RomEntry): string {
  const key = romKey(game)
  if (busyKey.value === key) return cachedKeys.value.has(key) ? '载入中' : '下载中'
  return cachedKeys.value.has(key) ? '启动' : '下载并启动'
}

function downloadLabel(game: RomEntry): string {
  const key = romKey(game)
  if (busyKey.value === key) return '下载中'
  return '下载'
}

function metaLine(game: RomEntry): string {
  const parts = [
    game.genre,
    game.publisher,
    game.mapper !== undefined ? `Mapper ${game.mapper}` : null,
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
  <section class="store-panel">
      <div class="store-tools">
        <SInput v-model:value="query" class="search" type="search" placeholder="搜索游戏、厂商、标签" />
        <RemoteSelect v-model="genre" class="select" :options="genreOptions" />
        <RemoteSelect v-model="sort" class="select" :options="SORT_OPTIONS" />
        <SCheckbox v-model:checked="downloadedOnly" class="check">已下载 ({{ cachedRoms.length }})</SCheckbox>
      </div>

      <div class="store-summary">
        <span>{{ catalogLoading ? '正在同步目录 · ' : '' }}匹配 {{ totalCount }} 个{{ totalCount ? `，显示第 ${pageStart + 1}-${pageEnd} 个` : '' }}</span>
        <SHint v-if="error" type="error" class="error" role="alert">{{ error }}</SHint>
      </div>

      <div class="game-list">
        <article
          v-for="game in visibleGames"
          :key="romKey(game)"
          class="game-card"
        >
          <div class="game-main">
            <div class="game-title-row">
              <h3>{{ game.name }}</h3>
              <STag size="small" class="cache-state" :type="cachedKeys.has(romKey(game)) ? 'success' : 'default'">
                {{ cachedKeys.has(romKey(game)) ? '已下载' : '未下载' }}
              </STag>
            </div>
            <p class="meta">{{ metaLine(game) }}</p>
            <div v-if="game.tags?.length" class="tags">
              <STag v-for="tag in game.tags.slice(0, 4)" :key="tag" size="small">{{ tag }}</STag>
            </div>
          </div>

          <div class="game-actions">
            <span v-if="busyKey === romKey(game) && progressLabel(game)" class="progress">
              {{ progressLabel(game) }}
            </span>
            <SButton
              v-if="!cachedKeys.has(romKey(game))"
              class="btn"
              :disabled="busyKey !== null"
              @click="downloadOnly(game)"
            >
              {{ downloadLabel(game) }}
            </SButton>
            <SButton class="btn primary" :disabled="busyKey !== null" @click="play(game)">
              {{ playLabel(game) }}
            </SButton>
            <SButton
              v-if="cachedKeys.has(romKey(game))"
              class="btn"
              :disabled="busyKey !== null"
              @click="removeCachedByKey(romKey(game))"
            >
              删除
            </SButton>
          </div>
        </article>

        <SEmpty v-if="visibleGames.length === 0" class="empty" :description="catalogLoading ? '正在加载 ROM 目录…' : '没有匹配的 ROM'" />
      </div>

      <div v-if="totalPages > 1" class="store-pager">
        <SButton class="pager-btn" :disabled="page <= 1" @click="goPage(1)">« 首页</SButton>
        <SButton class="pager-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</SButton>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <SButton class="pager-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</SButton>
        <SButton class="pager-btn" :disabled="page >= totalPages" @click="goPage(totalPages)">末页 »</SButton>
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
  grid-template-columns: minmax(160px, 1fr) minmax(120px, 170px) minmax(120px, 170px);
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
  .store-tools {
    grid-template-columns: 1fr;
  }
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
    grid-template-columns: minmax(120px, 1fr) minmax(80px, 130px) minmax(80px, 130px);
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
.store-tools { grid-template-columns: minmax(140px, 1fr) repeat(2, minmax(120px, 160px)) auto; }
.check { gap: 8px; white-space: nowrap; }
@media (max-width: 720px) {
  .store-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .search { grid-column: 1 / -1; }
}
@media (orientation: landscape) and (max-height: 540px) {
  .store-tools {
    flex-shrink: 0;
    grid-template-columns: minmax(100px, 1fr) minmax(90px, 120px) minmax(100px, 130px) auto;
    padding: 4px 12px;
    gap: 6px;
  }
  .search { grid-column: auto; }
  .check { height: 44px; }
  .store-summary { flex-shrink: 0; }
  .store-pager { padding: 4px 12px; }
  .game-list { grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); }
}
@media (orientation: landscape) and (max-height: 540px) and (max-width: 640px) {
  .store-tools { grid-template-columns: minmax(0, 1fr) minmax(90px, 110px); }
  .search { grid-column: auto; }
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
