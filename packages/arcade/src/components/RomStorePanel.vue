<script setup lang="ts">
import SCheckbox from '@qingfeng346/ui-kit/components/checkbox/SCheckbox.vue'
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dependencyPlan, loadCatalogs, type ArcadeCatalog, type CatalogGame } from '../store/catalog'
import type { Archive } from '../store/library'
import type { DependencyProgress } from '../store/dependencies'
import RemoteSelect from './RemoteSelect.vue'

type RomEntry = CatalogGame & { local?: Archive; catalog?: ArcadeCatalog }
const props = defineProps<{
  archives: Archive[]
  busy: boolean
  progress: DependencyProgress | null
  play: (game: CatalogGame, catalog: ArcadeCatalog) => Promise<void>
  download: (game: CatalogGame, catalog: ArcadeCatalog) => Promise<void>
  playCached: (game: Archive) => Promise<void>
  remove: (game: Archive) => Promise<void>
  importFiles: () => Promise<void>
}>()
const catalogs = ref<ArcadeCatalog[]>([])
const catalogLoading = ref(false)
const error = ref('')
const query = ref(''), genre = ref(''), downloadedOnly = ref(false)
const busyKey = ref<string | null>(null)
const abort = new AbortController()
onBeforeUnmount(() => abort.abort())
onMounted(refreshCatalog)
async function refreshCatalog() {
  if (catalogLoading.value) return
  catalogLoading.value = true
  error.value = ''
  try {
    const result = await loadCatalogs(abort.signal)
    catalogs.value = result.catalogs
    error.value = result.errors.join('；')
  } catch (err) {
    if (!abort.signal.aborted) error.value = err instanceof Error ? err.message : String(err)
  } finally { catalogLoading.value = false }
}
const romKey = (game: CatalogGame) => game.sha256.toLowerCase()
const cachedRoms = computed(() => props.archives.filter(a => a.kind === 'game'))
const libraryGames = computed(() => {
  const games = new Map<string, RomEntry>()
  for (const catalog of catalogs.value) for (const game of catalog.games) {
    if (!games.has(romKey(game))) games.set(romKey(game), { ...game, catalog })
  }
  for (const local of cachedRoms.value) {
    const existing = games.get(local.hash)
    if (existing) existing.local = local
    else games.set(local.hash, {
      name: local.name, rom_name: local.name.replace(/\.zip$/i, ''), file_name: local.name,
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
type SortMode = 'default' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' | 'publisher'
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '默认排序' }, { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' }, { value: 'size-asc', label: '体积 小→大' },
  { value: 'size-desc', label: '体积 大→小' }, { value: 'publisher', label: '按厂商' },
]
const sort = ref<SortMode>('default'), page = ref(1)
const PAGE_SIZE = 60
const sortedMatched = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  const games = libraryGames.value.filter(game =>
    (!downloadedOnly.value || cachedKeys.value.has(romKey(game))) &&
    (!genre.value || game.genre === genre.value) &&
    (!q || [game.name, game.file_name, game.genre, game.publisher, game.system, ...(game.tags ?? [])].join(' ').toLocaleLowerCase().includes(q)),
  )
  const name = (g: RomEntry) => g.name || g.file_name
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
watch([query, genre, sort, downloadedOnly], () => { page.value = 1 })
watch(totalPages, value => { page.value = Math.min(page.value, value) })
function goPage(target: number) { page.value = Math.max(1, Math.min(target, totalPages.value)) }
async function act(game: RomEntry, action: () => Promise<void>) {
  if (props.busy || busyKey.value) return
  busyKey.value = romKey(game)
  try { await action() } finally { busyKey.value = null }
}
async function play(game: RomEntry) {
  await act(game, () => game.catalog ? props.play(game, game.catalog) : props.playCached(game.local!))
}
async function downloadOnly(game: RomEntry) {
  if (game.catalog) await act(game, () => props.download(game, game.catalog!))
}
async function removeCached(game: RomEntry) {
  if (game.local) await act(game, () => props.remove(game.local!))
}
function progressLabel(game: RomEntry) {
  return busyKey.value === romKey(game) && props.progress
    ? `${props.progress.name} · ${Math.floor(props.progress.received / props.progress.total * 100)}%` : ''
}
function playLabel(game: RomEntry) {
  if (busyKey.value === romKey(game)) return '处理中'
  return cachedKeys.value.has(romKey(game)) ? '启动' : '下载并启动'
}
const downloadLabel = (game: RomEntry) => busyKey.value === romKey(game) ? '下载中' : '下载'
const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const metaLine = (game: RomEntry) => [game.system, game.genre, game.publisher, formatSize(game.file_size)].filter(Boolean).join(' · ')
</script>

<template>
  <section class="store-panel">
      <div class="store-tools">
        <SInput v-model:value="query" class="search" type="search" placeholder="搜索游戏、厂商、标签" aria-label="搜索街机游戏" />
        <RemoteSelect v-model="genre" class="select" :options="genreOptions" />
        <RemoteSelect v-model="sort" class="select" :options="SORT_OPTIONS" />
        <SCheckbox v-model:checked="downloadedOnly" class="check">已下载 ({{ cachedKeys.size }})</SCheckbox>
      </div>

      <div class="store-summary">
        <SButton v-if="error" :disabled="busy || catalogLoading" @click="refreshCatalog">重试目录</SButton>
        <SButton :disabled="busy" @click="importFiles">导入游戏 ZIP</SButton>
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
              <h3>{{ game.name || game.file_name }}</h3>
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
              v-if="game.catalog && !cachedKeys.has(romKey(game))"
              class="btn"
              :disabled="busy || busyKey !== null"
              @click="downloadOnly(game)"
            >
              {{ downloadLabel(game) }}
            </SButton>
            <SButton class="btn primary" :disabled="busy || busyKey !== null" @click="play(game)">
              {{ playLabel(game) }}
            </SButton>
            <SButton
              v-if="game.local"
              class="btn"
              :disabled="busy || busyKey !== null"
              @click="removeCached(game)"
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
