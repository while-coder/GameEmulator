<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { PlayerEntry } from '../../../player-ui/playerEntry'
import LobbySearchKeyboard from './LobbySearchKeyboard.vue'
import RemoteSelect from '../../../player-ui/RemoteSelect.vue'
import PlayerSaveList from '../../../player-ui/PlayerSaveList.vue'
import { loadLobbySaves } from './lobbySaveList'
import LibraryLoading from '../../../player-ui/LibraryLoading.vue'
import { useLibraryOperation } from '../../../player-ui/useLibraryOperation'
import { useRemoteNav } from '../../../player-ui/useRemoteNav'
import { focusNavigationElement } from '../../../player-ui/remoteNavigation'
import { compareGameNames, createGameSearch } from '../../../shared/gameText'
import type { GameSystem } from '../../../shared/playHistory'
import { onlinePlatforms, platforms, useLobbyLibrary, type LobbyDownloadProgress, type LobbyGame } from './useLobbyLibrary'
import { densityOptions, loadPreferences, readLobbyReturn, saveLobbyReturn, savePreferences, type LobbyState, type LobbyTab } from './lobbyPreferences'
import LobbyGameCard from './LobbyGameCard.vue'
import '../../../player-ui/library.css'

const PAGE_SIZE = 36
const props = withDefaults(defineProps<{ active?: boolean; nativeSaves?: boolean; launch: (system: GameSystem, entry?: PlayerEntry) => Promise<void> | void }>(), { active: true })
const emit = defineEmits<{ unhandledBack: [] }>()
const root = ref<HTMLElement | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const settingsArea = ref<HTMLElement | null>(null)
const launchError = ref('')
const navigating = ref(false)
const saveGame = shallowRef<LobbyGame | null>(null)
const savePanel = ref<InstanceType<typeof PlayerSaveList> | null>(null)
const removing = ref(false)
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const downloadProgress = ref<LobbyDownloadProgress | null>(null)
const busy = computed(() => navigating.value || removing.value || !!operation.value)
const preferences = reactive(loadPreferences())
watch(preferences, savePreferences)

const saved = readLobbyReturn()
const selectedTab = ref<LobbyTab>(saved?.tab ?? preferences.tab)
const page = ref(saved?.page ?? 1)
const searchOpen = ref(saved?.searchOpen ?? false)
const searchQuery = ref(saved?.searchQuery ?? '')
const searchPage = ref(saved?.searchPage ?? 1)
const settingsOpen = ref(saved?.settingsOpen ?? false)
let browseScroll = saved?.browseScroll ?? 0
let browseBeforeSettings = saved?.browseBeforeSettings ?? 0
const pendingReturn = ref(saved)
let launchState: LobbyState | undefined

const tabs = [{ value: 'mine', label: '我的游戏' }, { value: 'favorites', label: '收藏' }, ...onlinePlatforms] as const
const onlineTab = computed(() => onlinePlatforms.find(platform => platform.value === selectedTab.value))
const sortOptions = [
  { value: 'default', label: '默认排序' },
  { value: 'name', label: '按名称' },
  { value: 'recent', label: '最近游玩优先' },
] as const
const { sources, games } = useLobbyLibrary()
const gameId = (game: LobbyGame) => `${game.system}:${game.key}`
const currentPage = computed({
  get: () => searchOpen.value ? searchPage.value : page.value,
  set: value => { if (searchOpen.value) searchPage.value = value; else page.value = value },
})
const relevantSources = computed(() => searchOpen.value ? sources : sources.filter(source => source.platform.value === selectedTab.value))
const loading = computed(() => searchOpen.value || onlineTab.value
  ? relevantSources.value.some(source => source.loading.value)
  : selectedTab.value === 'mine' && sources.some(source => source.localLoading.value))
const failures = computed(() => relevantSources.value.filter(source => source.failed.value))
const hasQuery = computed(() => searchQuery.value.trim().length > 0)
const filtered = computed(() => {
  let list: LobbyGame[]
  if (searchOpen.value) {
    if (!hasQuery.value) return []
    const matches = createGameSearch(searchQuery.value)
    list = games.value.filter(game => matches(game.terms))
  } else if (selectedTab.value === 'mine') list = games.value.filter(game => game.local || game.lastPlayedAt > 0)
  else if (selectedTab.value === 'favorites') list = games.value.filter(game => game.favorite)
  else list = games.value.filter(game => game.system === selectedTab.value && game.online)
  if (preferences.sort === 'name') list.sort((a, b) => compareGameNames(a.name, b.name))
  if (preferences.sort === 'recent' || (preferences.sort === 'default' && !searchOpen.value && selectedTab.value === 'mine')) {
    list.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  }
  return list
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const visibleGames = computed(() => filtered.value.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE))
const emptyMessage = computed(() => {
  if (searchOpen.value && !hasQuery.value) return '输入游戏名或拼音搜索'
  if (loading.value) return '正在读取游戏…'
  if (searchOpen.value) return '没有找到匹配的游戏'
  if (selectedTab.value === 'mine') return '玩过或下载的游戏会显示在这里，也可以从平台设置导入'
  if (selectedTab.value === 'favorites') return '长按或右键点击游戏卡片即可收藏'
  return '当前没有可显示的在线游戏'
})
const focusId = (game: LobbyGame) => `game:${gameId(game)}`

function focusById(id: string, reveal = false): boolean {
  for (const item of root.value?.querySelectorAll<HTMLElement>('[data-lobby-focus]') ?? []) {
    if (item.dataset.lobbyFocus !== id || !item.getClientRects().length) continue
    const target = item.matches('button') ? item : item.querySelector<HTMLElement>('[data-nav-primary], button')
    if (!target?.getClientRects().length) continue
    if (reveal) focusNavigationElement(target)
    else target.focus({ preventScroll: true })
    return true
  }
  return false
}

watch([loading, totalPages], () => {
  if (!loading.value && !pendingReturn.value && currentPage.value > totalPages.value) currentPage.value = totalPages.value
})
watch([loading, settingsOpen, visibleGames], restoreLobby, { flush: 'post' })

async function restoreLobby() {
  const state = pendingReturn.value
  if (!state) return
  if (!settingsOpen.value && loading.value) return
  pendingReturn.value = undefined
  if (!settingsOpen.value) {
    const selected = filtered.value.findIndex(game => focusId(game) === state.focus)
    currentPage.value = selected >= 0 ? Math.floor(selected / PAGE_SIZE) + 1 : Math.min(currentPage.value, totalPages.value)
  }
  await nextTick()
  const area = settingsOpen.value ? settingsArea.value : scrollArea.value
  if (area) area.scrollTop = state.scroll
  if (!focusById(state.focus, true)) focusDefault()
}

function focusDefault() {
  if (settingsOpen.value) focusById('close-settings')
  else if (searchOpen.value) focusById('search-keyboard')
  else focusById(`tab:${selectedTab.value}`)
}

function resetScroll() { if (scrollArea.value) scrollArea.value.scrollTop = 0 }
function selectTab(value: LobbyTab) {
  if (value === selectedTab.value) return
  pendingReturn.value = undefined
  selectedTab.value = value
  page.value = 1
  resetScroll()
}
function changePage(delta: number) {
  currentPage.value += delta
  resetScroll()
  void nextTick(() => {
    const game = visibleGames.value[0]
    if (game) focusById(focusId(game))
  })
}
function openSearch() {
  pendingReturn.value = undefined
  browseScroll = scrollArea.value?.scrollTop ?? 0
  searchQuery.value = ''
  searchPage.value = 1
  searchOpen.value = true
  void nextTick(() => { resetScroll(); focusDefault() })
}
function closeSearch() {
  pendingReturn.value = undefined
  searchOpen.value = false
  void nextTick(() => {
    if (scrollArea.value) scrollArea.value.scrollTop = browseScroll
    focusById('search')
  })
}
watch(searchQuery, () => {
  if (!searchOpen.value) return
  searchPage.value = 1
  resetScroll()
})

function openSettings() {
  pendingReturn.value = undefined
  browseBeforeSettings = scrollArea.value?.scrollTop ?? 0
  settingsOpen.value = true
  void nextTick(focusDefault)
}
function closeSettings() {
  settingsOpen.value = false
  void nextTick(() => {
    if (scrollArea.value) scrollArea.value.scrollTop = browseBeforeSettings
    focusById('settings')
  })
}

function closeSaves() {
  const game = saveGame.value
  saveGame.value = null
  if (game) void nextTick(() => {
    if (!focusById(focusId(game), true)) focusDefault()
  })
}

function loadSaves() {
  const game = saveGame.value
  if (!game) return Promise.resolve([])
  return loadLobbySaves(game.system, game.key, !!props.nativeSaves, async saveKey => {
    await goToPlayer(game.system, focusId(game), game, saveKey)
    saveGame.value = null
  })
}

async function goToPlayer(system: GameSystem, focus: string, game?: LobbyGame, saveKey?: string) {
  if (!props.active || busy.value) return
  const entry: PlayerEntry = game ? { kind: 'play', key: game.key, name: game.name.slice(0, 180), saveKey } : { kind: 'settings' }
  game?.remember()
  launchState = {
    tab: selectedTab.value, page: page.value,
    searchOpen: searchOpen.value, searchQuery: searchQuery.value,
    searchPage: searchPage.value, browseScroll, browseBeforeSettings, settingsOpen: settingsOpen.value,
    focus, scroll: (settingsOpen.value ? settingsArea.value : scrollArea.value)?.scrollTop ?? 0,
  }
  saveLobbyReturn(launchState)
  navigating.value = true
  launchError.value = ''
  try {
    await props.launch(system, entry)
  } catch (reason) {
    launchError.value = `无法打开模拟器：${reason instanceof Error ? reason.message : String(reason)}`
    await resume()
    if (saveKey) throw reason
  }
}

async function changeCache(game: LobbyGame, action: 'download' | 'remove') {
  if (busy.value) return
  launchError.value = ''
  try {
    if (action === 'download' && game.download) {
      const download = game.download
      await runOperation(game.name, 'download', signal => download(signal, value => { downloadProgress.value = value }))
    } else if (action === 'remove' && game.removeCache) {
      removing.value = true
      await game.removeCache()
    }
  } catch (reason) {
    launchError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    downloadProgress.value = null
    removing.value = false
    await nextTick()
    if (!focusById(focusId(game), true)) focusDefault()
  }
}

async function resume() {
  const state = launchState
  launchState = undefined
  if (!state) return
  readLobbyReturn()
  navigating.value = false
  await Promise.all(sources.map(source => source.refreshLocal()))
  pendingReturn.value = state
  await restoreLobby()
}

function handleBack(): boolean {
  if (operation.value) { cancelOperation(); return true }
  if (saveGame.value) { savePanel.value?.back(); return true }
  const menu = document.querySelector<HTMLDialogElement>('dialog.game-card-menu[open]')
  if (menu) { menu.close(); return true }
  const filter = document.querySelector<HTMLElement>('.rs-backdrop')
  if (filter) { filter.click(); return true }
  if (settingsOpen.value) closeSettings()
  else if (searchOpen.value) closeSearch()
  else return false
  return true
}

function retry() {
  for (const source of failures.value) void source.load(true)
}

useRemoteNav({
  container: root,
  active: computed(() => props.active && !busy.value && !saveGame.value),
  autoFocus: true,
  onBack: () => { if (!handleBack()) emit('unhandledBack') },
})
defineExpose({ handleBack, resume, focusDefault })
onMounted(() => {
  document.documentElement.classList.add('game-lobby-page')
  for (const source of sources) void source.load()
  if (pendingReturn.value) void restoreLobby()
  else void nextTick(focusDefault)
})
onBeforeUnmount(() => document.documentElement.classList.remove('game-lobby-page'))
</script>

<template>
  <main ref="root" class="game-lobby" :data-density="preferences.density">
    <header class="lobby-header" data-nav-row>
      <button v-if="settingsOpen" type="button" data-lobby-focus="close-settings" @click="closeSettings">‹ 返回</button>
      <button v-else-if="searchOpen" type="button" @click="closeSearch">‹ 返回</button>
      <h1>{{ settingsOpen ? '设置' : searchOpen ? '搜索游戏' : '游戏大厅' }}</h1>
      <div v-if="!settingsOpen && !searchOpen" class="lobby-header-actions">
        <button type="button" data-lobby-focus="search" @click="openSearch">搜索</button>
        <button type="button" data-lobby-focus="settings" @click="openSettings">设置</button>
      </div>
    </header>

    <div v-if="settingsOpen" ref="settingsArea" class="lobby-settings">
      <section aria-labelledby="lobby-settings-title">
        <h2 id="lobby-settings-title">大厅设置</h2>
        <div class="settings-row"><span>默认标签页</span><RemoteSelect v-model="preferences.tab" :options="[...tabs]" aria-label="默认标签页" /></div>
        <div class="settings-row"><span>游戏排序</span><RemoteSelect v-model="preferences.sort" :options="[...sortOptions]" aria-label="游戏排序" /></div>
        <div class="settings-row"><span>卡片密度</span><RemoteSelect v-model="preferences.density" :options="[...densityOptions]" aria-label="卡片密度" /></div>
      </section>
      <section aria-labelledby="platform-settings-title">
        <h2 id="platform-settings-title">平台设置</h2>
        <div v-for="item in platforms" :key="item.value" class="settings-row" data-nav-row>
          <span>{{ item.label }}</span>
          <button type="button" :data-lobby-focus="`settings:${item.value}`" :aria-label="`${item.label}设置`"
            @click="goToPlayer(item.value, `settings:${item.value}`)">打开设置</button>
        </div>
      </section>
    </div>

    <template v-else>
      <nav v-if="!searchOpen" class="lobby-platforms" role="tablist" aria-label="游戏库" data-nav-row>
        <button v-for="tab in tabs" :id="`lobby-tab-${tab.value}`" :key="tab.value" type="button" role="tab"
          :aria-selected="selectedTab === tab.value" aria-controls="lobby-tab-content"
          :data-lobby-focus="`tab:${tab.value}`" @click="selectTab(tab.value)">{{ tab.label }}</button>
      </nav>

      <div class="lobby-content" :class="{ 'search-layout': searchOpen }">
        <LobbySearchKeyboard v-if="searchOpen" v-model="searchQuery" />
        <section class="lobby-tab-content" :id="searchOpen ? undefined : 'lobby-tab-content'"
          :role="searchOpen ? 'region' : 'tabpanel'" :aria-labelledby="searchOpen ? 'lobby-results-title' : `lobby-tab-${selectedTab}`">
          <h2 v-if="searchOpen" id="lobby-results-title">搜索结果</h2>
          <div v-if="(!searchOpen || hasQuery) && failures.length" class="lobby-status">
            <span>{{ failures.map(source => source.platform.label).join('、') }}目录刷新失败{{ failures.every(source => source.hasOnlineCatalog.value) ? '，正在显示上次的目录' : '' }}</span>
            <button type="button" @click="retry">重试</button>
          </div>
          <div ref="scrollArea" class="lobby-scroll player-library">
            <div v-if="visibleGames.length" :id="searchOpen ? 'lobby-search-results' : undefined" class="lobby-grid" data-nav-grid
              :data-nav-exit-left="searchOpen ? '#lobby-search-keyboard [data-search-key]' : undefined">
              <LobbyGameCard v-for="game in visibleGames" :key="gameId(game)" :game="game" :focus-id="focusId(game)" :disabled="busy"
                @play="goToPlayer(game.system, focusId(game), game)" @saves="saveGame = game"
                @download="changeCache(game, 'download')" @remove="changeCache(game, 'remove')" />
            </div>
            <p v-else class="lobby-empty" role="status">{{ emptyMessage }}</p>
          </div>
        </section>
      </div>

      <footer v-if="!searchOpen || hasQuery" class="lobby-footer">
        <small aria-live="polite">{{ filtered.length }} 款<span v-if="loading"> · 正在读取游戏</span></small>
        <nav v-if="totalPages > 1" class="lobby-pagination" data-nav-row data-nav-fallback="[data-nav-primary]" aria-label="游戏分页">
          <button type="button" :disabled="currentPage <= 1" @click="changePage(-1)">‹ 上一页</button>
          <span>{{ currentPage }} / {{ totalPages }}</span>
          <button type="button" :disabled="currentPage >= totalPages" @click="changePage(1)">下一页 ›</button>
        </nav>
        <small v-if="visibleGames.length" class="lobby-help">确定开始 · 长按更多</small>
      </footer>
    </template>
    <p v-if="launchError" class="lobby-status" role="alert">{{ launchError }}</p>
    <PlayerSaveList v-if="saveGame" ref="savePanel" :game-name="saveGame.name" :load="loadSaves" @close="closeSaves" />
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action"
      :progress="downloadProgress" :cancelling="cancelling" @cancel="cancelOperation" />
    <slot name="footer" />
  </main>
</template>

<style scoped>
:global(html.game-lobby-page) { color-scheme: dark; background: #171c24; }
:global(.game-lobby-page body) { margin: 0; }
.game-lobby {
  --lobby-card-min: clamp(130px, 15vw, 250px);
  --lobby-search-card-min: clamp(110px, 13vw, 200px);
  --lobby-card-gap: 9px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  gap: 10px;
  margin: 0;
  padding: 14px clamp(14px, 2.8vw, 48px) 10px;
  overflow: hidden;
  background: #171c24;
  color: #edf1f7;
  font: 15px/1.35 system-ui, sans-serif;
}
.game-lobby[data-density="compact"] {
  --lobby-card-min: clamp(100px, 11vw, 185px);
  --lobby-search-card-min: clamp(94px, 10vw, 160px);
}
.game-lobby[data-density="large"] {
  --lobby-card-min: clamp(153px, 17.3vw, 288px);
  --lobby-search-card-min: clamp(126px, 14.6vw, 230px);
  --lobby-card-gap: 10px;
  --lobby-card-title: clamp(13px, 1.45vw, 20px);
  --lobby-card-title-lines: 2;
}
.game-lobby[data-density="extra-large"] {
  --lobby-card-min: clamp(178px, 20vw, 330px);
  --lobby-search-card-min: clamp(145px, 16.4vw, 270px);
  --lobby-card-gap: 12px;
  --lobby-card-title: clamp(14px, 1.55vw, 22px);
  --lobby-card-title-lines: 2;
}
.lobby-header, .lobby-header-actions, .lobby-platforms, .lobby-footer, .lobby-pagination, .lobby-status { display: flex; align-items: center; gap: 8px; }
.lobby-header { min-height: 38px; }
.lobby-header h1 { flex: 1; margin: 0; font-size: clamp(19px, 2.6vw, 36px); line-height: 1.2; }
.lobby-header-actions { min-width: 0; }
.game-lobby button:not(.game-launch) {
  min-height: 34px;
  padding: 5px 11px;
  border: 1px solid #465368;
  border-radius: 7px;
  background: #252d39;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.game-lobby :deep(:is(button, input):focus-visible) { outline: 3px solid #8aafe0; outline-offset: 2px; }
.game-lobby button:disabled { opacity: .45; cursor: default; }
.game-lobby button[aria-selected="true"] { border-color: #7ea9df; background: #304b70; }
.lobby-platforms { flex-wrap: wrap; }
.lobby-status { justify-content: space-between; color: #f5d394; font-size: .9em; }
.lobby-scroll, .lobby-settings { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.lobby-content, .lobby-tab-content { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.search-layout {
  display: grid;
  grid-template-columns: clamp(205px, 27vw, 330px) minmax(0, 1fr);
  gap: clamp(14px, 2.2vw, 32px);
  --lobby-card-min: var(--lobby-search-card-min);
}
.search-layout > .search-keyboard { max-height: 100%; overflow-y: auto; }
.lobby-scroll { padding: 5px; scrollbar-width: thin; }
.lobby-tab-content h2, .lobby-settings h2 { margin: 0 0 7px; font-size: clamp(14px, 1.6vw, 21px); }
.lobby-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--lobby-card-min)), 1fr)); gap: var(--lobby-card-gap); }
.lobby-footer { min-height: 34px; justify-content: space-between; color: #b3bfce; }
.lobby-pagination { justify-content: center; }
.lobby-pagination span { min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; }
.lobby-help { white-space: nowrap; }
.lobby-empty { padding: 25px 0; color: #b3bfce; text-align: center; }
.lobby-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 22px; padding: 4px; }
.lobby-settings section { min-width: 0; }
.settings-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 46px; border-bottom: 1px solid #364254; }
@media (max-width: 600px) {
  .game-lobby { font-size: 13px; gap: 7px; padding: 9px 12px; }
  .lobby-platforms { gap: 5px; }
  .lobby-help { display: none; }
  .lobby-settings { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}
@media (max-width: 550px) {
  .search-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px; }
  .game-lobby[data-density="large"] .lobby-grid,
  .game-lobby[data-density="extra-large"] .lobby-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .game-lobby[data-density="large"] { --lobby-card-preview-ratio: 3 / 2; }
  .game-lobby[data-density="extra-large"] { --lobby-card-preview-ratio: 4 / 3; }
}
</style>
