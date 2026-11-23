<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import ConsoleSettings from './ConsoleSettings.vue'
import LibraryRequestStatus from '../../player-ui/LibraryRequestStatus.vue'
import { useSettingsTab } from '../../player-ui/useSettingsTab'
import LibraryTabs from '../../player-ui/LibraryTabs.vue'
import GamePreview from '../../player-ui/GamePreview.vue'
import GameCardActions from '../../player-ui/GameCardActions.vue'
import LibraryLoading from '../../player-ui/LibraryLoading.vue'
import PauseMenu from '../../player-ui/PauseMenu.vue'
import BackConfirmDialog from '../../player-ui/BackConfirmDialog.vue'
import RemoteSelect from '../../player-ui/RemoteSelect.vue'
import { useLibraryBrowser } from '../../player-ui/useLibraryBrowser'
import { useLibraryOperation } from '../../player-ui/useLibraryOperation'
import { useGameCollection } from '../../player-ui/useGameCollection'
import { usePlayHistory, usePlaySession } from '../../player-ui/usePlayHistory'
import { useRemoteNav } from '../../player-ui/useRemoteNav'
import { useFullscreen } from '../../player-ui/useFullscreen'
import { compareGameNames, createGameSearch } from '../../shared/gameText'
import { formatPlayTime, sortRecentlyPlayed } from '../../shared/playHistory'
import { nextSaveLabel, type SaveKind } from '../../shared/saveSlots'
import type { TouchControlLayout } from '../../player-ui/touchLayout'
import { readTouchControl } from '../../player-ui/touchLayout'
import { acquireGame, importGame, listGames, listStates, loadCatalog, putState, removeGame, removeState, renameState, type Game, type Snapshot } from './store'
import { createConsoleRunner, type ConsoleRunner } from './runner'
import { gameAspect, defaultKeymap, isStickKey, keyboardActions, PADMAP, systems, type ConsoleSystem, type Action, type KeyboardAction, type StickKey, type ConsoleSettings as Settings } from './systems'
import TouchControls from './TouchControls.vue'
import '../../player-ui/library.css'
import '../../player-ui/player.css'

const props = defineProps<{ system: ConsoleSystem; onLeave: () => void | Promise<void> }>()
const system = props.system, config = systems[system]
const keyActions = keyboardActions(system)
const root = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null), pausePanel = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const fullscreen = useFullscreen(computed(() => document.documentElement))
const current = shallowRef<Game | null>(null), runner = shallowRef<ConsoleRunner | null>(null)
const paused = ref(false), visible = ref(!document.hidden), leaving = ref(false), leaveConfirm = ref(false)
const settingsOpen = ref(false), settingsTab = useSettingsTab(system), settingsPanel = ref<InstanceType<typeof ConsoleSettings> | null>(null)
const error = ref(''), message = ref('')
const busyAction = ref(false), editingLayout = ref(false), layoutDraft = ref<Layout>()
const catalog = ref<Game[]>([]), downloaded = ref<Game[]>([]), refreshing = ref(false), catalogError = ref('')
const tab = ref<'online' | 'played' | 'favorites'>(config.catalogUrl ? 'online' : 'played')
const { query, genre, sort, page, gameList } = useLibraryBrowser(system, tab)
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const progress = ref<{ received: number; total: number } | null>(null)
const { history } = usePlayHistory(system), collection = useGameCollection<Game>(system)
const catalogKey = `console:${system}:catalog`, settingsKey = `console:${system}:settings`
type Layout = Record<'portrait' | 'landscape', Partial<Record<string, TouchControlLayout>>>
const settings = reactive<Settings>({ muted: false, smoothing: false, aspect: 'auto', touch: 'auto', keymaps: [defaultKeymap(0, system), defaultKeymap(1)], touchLayout: { portrait: {}, landscape: {} } })
try {
  const legacySourceKey = `console:${system}:source`
  const legacySource = localStorage.getItem(legacySourceKey)
  if (legacySource && legacySource !== config.catalogUrl) localStorage.removeItem(catalogKey)
  localStorage.removeItem(legacySourceKey)
  const cached: unknown = JSON.parse(localStorage.getItem(catalogKey) ?? '[]')
  if (Array.isArray(cached)) catalog.value = cached.filter(game => game && typeof game.hash === 'string' && typeof game.name === 'string')
  const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null')
  if (saved) {
    settings.muted = saved.muted === true; settings.smoothing = saved.smoothing === true
    if (['auto', '4:3', '3:2', '10:9', '1:1', '16:9'].includes(saved.aspect)) settings.aspect = saved.aspect
    if (['auto', 'always', 'never'].includes(saved.touch)) settings.touch = saved.touch
    for (let player = 0; player < config.players; player++) for (const action of keyActions) {
      const code = saved.keymaps?.[player]?.[action]
      if (typeof code === 'string' && code.length < 40) settings.keymaps[player][action] = code
    }
    for (const orientation of ['portrait', 'landscape'] as const) for (const [key, value] of Object.entries(saved.touchLayout?.[orientation] ?? {})) {
      const layout = readTouchControl(value)
      if (layout && (key === 'dpad' || system === 'psp' && key === 'analog' || config.actions.includes(key as Action))) settings.touchLayout[orientation][key] = layout
    }
  }
} catch { /* Use defaults if storage is unavailable or damaged. */ }
watch(settings, value => { try { localStorage.setItem(settingsKey, JSON.stringify(value)) } catch { error.value = '设置无法保存，请检查设备存储空间' } }, { deep: true })
const busy = computed(() => !!operation.value || busyAction.value || leaving.value)
const playing = computed(() => !!current.value && !paused.value && !settingsOpen.value && !editingLayout.value && !busy.value && !leaveConfirm.value && visible.value)
usePlaySession(system, computed(() => current.value?.hash ?? null), playing)
const aspect = computed(() => settings.aspect === 'auto' ? (current.value ? gameAspect(system, current.value.fileName) : config.aspect) : Number(settings.aspect.split(':')[0]) / Number(settings.aspect.split(':')[1]))
const touchVisible = computed(() => settings.touch === 'always' || settings.touch === 'auto' && !document.documentElement.classList.contains('android-tv') && matchMedia('(pointer: coarse)').matches)
const cacheKeys = computed(() => new Set(downloaded.value.map(game => game.hash)))
const known = computed(() => [...new Map([...collection.games.value, ...downloaded.value, ...catalog.value].map(game => [game.hash, game])).values()])
const groups = computed(() => ({ online: catalog.value, played: known.value.filter(game => cacheKeys.value.has(game.hash) || !!history.value[game.hash]), favorites: known.value.filter(game => collection.isFavorite(game.hash)) }))
const counts = computed(() => ({ online: groups.value.online.length, played: groups.value.played.length, favorites: groups.value.favorites.length }))
const genres = computed(() => [{ value: '', label: '全部类型' }, ...[...new Set(groups.value[tab.value].map(game => game.genre).filter((value): value is string => !!value))].sort().map(value => ({ value, label: value }))])
const filtered = computed(() => {
  const matches = createGameSearch(query.value)
  const games = groups.value[tab.value].filter(game => (!genre.value || game.genre === genre.value) && matches([game.name, game.fileName, game.publisher, game.genre, ...(game.tags ?? [])]))
  switch (sort.value) {
    case 'recent': return sortRecentlyPlayed(games, game => game.hash, history.value)
    case 'name-asc': return games.sort((a, b) => compareGameNames(a.name, b.name))
    case 'name-desc': return games.sort((a, b) => compareGameNames(b.name, a.name))
    case 'size-asc': return games.sort((a, b) => a.file_size - b.file_size)
    case 'size-desc': return games.sort((a, b) => b.file_size - a.file_size)
    case 'publisher': return games.sort((a, b) => compareGameNames(a.publisher ?? '', b.publisher ?? ''))
    default: return games
  }
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 50)))
const pageGames = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50))
watch(pages, count => { if (page.value > count) page.value = count })
const sortOptions = [{ value: 'default', label: '默认排序' }, { value: 'recent', label: '最近游玩' }, { value: 'name-asc', label: '名称 A→Z' }, { value: 'name-desc', label: '名称 Z→A' }, { value: 'size-asc', label: '体积 小→大' }, { value: 'size-desc', label: '体积 大→小' }, { value: 'publisher', label: '厂商' }]
const states = ref<Snapshot[]>([]), allStates = ref<Snapshot[]>([])
const pauseOpen = computed({ get: () => !!current.value && paused.value && !settingsOpen.value && !editingLayout.value, set: value => { if (!value && !busy.value) paused.value = false } })
let messageTimer: ReturnType<typeof setTimeout> | undefined, batteryTimer: ReturnType<typeof setInterval> | undefined
let refreshController: AbortController | undefined, disposed = false, raf = 0
function notify(text: string) { message.value = text; clearTimeout(messageTimer); messageTimer = setTimeout(() => { message.value = '' }, 3500) }
async function guard(action: () => Promise<void>) { try { error.value = ''; await action() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function syncDownloads() { downloaded.value = (await listGames(system)).map(({ file: _, ...game }) => game) }
async function refreshCatalog() {
  if (refreshing.value || !config.catalogUrl) return
  refreshing.value = true; catalogError.value = ''; refreshController = new AbortController()
  try {
    const games = await loadCatalog(system, config.catalogUrl, refreshController.signal)
    if (disposed) return
    catalog.value = games
    try { localStorage.setItem(catalogKey, JSON.stringify(games)) } catch { notify('目录已更新，但无法缓存到本地') }
    await syncDownloads()
  } catch (reason) { if (!disposed) catalogError.value = `${reason instanceof Error ? reason.message : String(reason)}${catalog.value.length ? '；正在显示缓存目录' : ''}` }
  finally { refreshing.value = false }
}
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = ''
  if (!files.length || busy.value) return
  busyAction.value = true
  await guard(async () => {
    for (const file of files) { const game = await importGame(system, file); collection.remember(game.hash, game) }
    await syncDownloads(); tab.value = 'played'; settingsOpen.value = false; notify(`已导入 ${files.length} 个游戏`)
  })
  await guard(syncDownloads); busyAction.value = false
}
async function launch(game: Game, action: 'play' | 'download' = 'play') {
  if (busy.value) return
  error.value = ''; progress.value = null
  await guard(async () => {
    await runOperation(game.name, action, async signal => {
      const saved = await acquireGame(system, game, signal, (received, total) => { progress.value = { received, total } })
      collection.remember(game.hash, game); await syncDownloads(); signal.throwIfAborted()
      if (action === 'download') { notify('下载完成'); return }
      await runner.value?.dispose(); current.value = null
      const next = await createConsoleRunner(canvas.value!, system); runner.value = next
      next.onError = reason => { paused.value = true; error.value = reason.message }
      try {
        await next.load(saved, signal); signal.throwIfAborted()
        current.value = game; paused.value = false; next.setMuted(settings.muted); next.setSmoothing?.(settings.smoothing)
      } catch (reason) { await next.dispose(); runner.value = null; throw reason }
    })
  })
}
const sources = new Map<string, Set<string>>()
const heldStickKeys = new Set<StickKey>()
let touchStick: [number, number] = [0, 0]
let padStick: [number, number] = [0, 0]
let lastStick: [number, number] = [0, 0]
function updateStick() {
  const keyboardStick = [
    Number(heldStickKeys.has('stickRight')) - Number(heldStickKeys.has('stickLeft')),
    Number(heldStickKeys.has('stickDown')) - Number(heldStickKeys.has('stickUp')),
  ]
  const activeStick = touchStick.some(Boolean) ? touchStick : keyboardStick.some(Boolean) ? keyboardStick : padStick
  const [x, y] = playing.value ? activeStick : [0, 0]
  if (x !== lastStick[0] || y !== lastStick[1]) {
    runner.value?.analog?.(x, y)
    lastStick = [x, y]
  }
}
function touchAnalog(x: number, y: number) {
  touchStick = [x, y]
  updateStick()
}
function keyboardInput(player: number, action: KeyboardAction, down: boolean) {
  if (!isStickKey(action)) { input('keyboard', player, action, down); return }
  if (down) heldStickKeys.add(action)
  else heldStickKeys.delete(action)
  updateStick()
}
function input(sourceId: string, player: number, action: Action, down: boolean) {
  const key = `${player}:${action}`, held = sources.get(key) ?? new Set<string>(), previous = held.size > 0
  if (down && playing.value) held.add(sourceId); else held.delete(sourceId)
  if (held.size) sources.set(key, held); else sources.delete(key)
  if (previous !== (held.size > 0)) runner.value?.input(player, action, held.size > 0)
}
function releaseInputs() {
  for (const key of sources.keys()) { const [player, action] = key.split(':'); runner.value?.input(Number(player), action as Action, false) }
  sources.clear(); heldStickKeys.clear()
  touchStick = [0, 0]; padStick = [0, 0]
  runner.value?.analog?.(0, 0); lastStick = [0, 0]
}
watch(playing, value => {
  releaseInputs()
  if (value) runner.value?.resume()
  else { runner.value?.pause(); if (current.value) void guard(async () => { await runner.value?.flush() }) }
}, { flush: 'sync' })
watch(() => settings.muted, value => runner.value?.setMuted(value))
watch(() => settings.smoothing, value => runner.value?.setSmoothing?.(value))
watch(fullscreen.isFullscreen, (value, previous) => { if (previous && !value && current.value) paused.value = true })
useRemoteNav({ container: root, active: computed(() => !current.value && !settingsOpen.value && !busy.value && !leaveConfirm.value && !editingLayout.value), autoFocus: true, onBack: back })
useRemoteNav({ container: pausePanel, active: computed(() => pauseOpen.value && !busy.value && !leaveConfirm.value), autoFocus: true, priority: 5, onBack: back })
async function syncStates() {
  allStates.value = await listStates(system)
  states.value = current.value && runner.value ? allStates.value.filter(state => state.hash === current.value!.hash && state.build === runner.value!.build) : []
}
async function showSettings(tab?: typeof settingsTab.value) {
  if (tab) settingsTab.value = tab
  await guard(syncStates)
  settingsOpen.value = true
}
async function renameSave(state: Snapshot, label: string) { await guard(async () => { await renameState(state, label); await syncStates() }) }
async function deleteSave(state: Snapshot) { await guard(async () => { await removeState(state); await syncStates() }) }
async function save(kind: SaveKind = 'normal') {
  if (!current.value || !runner.value || busy.value) return
  busyAction.value = true
  await guard(async () => {
    await syncStates()
    await putState(system, current.value!.hash, runner.value!.build, kind, kind === 'quick' ? '快速存档' : nextSaveLabel(states.value), await runner.value!.save(), current.value!.name)
    await syncStates(); notify('进度已保存')
  })
  busyAction.value = false
}
async function restore(state: Snapshot) {
  if (busy.value) return
  if (runner.value && state.build !== runner.value.build) { error.value = '此存档属于其他内核版本，已保留原存档'; return }
  if (!runner.value || state.hash !== current.value?.hash) {
    const game = known.value.find(game => game.hash === state.hash)
    if (!game) { error.value = '找不到此存档对应的游戏，请先导入 ROM 或恢复游戏源'; return }
    await launch(game)
  }
  if (!runner.value || state.hash !== current.value?.hash) return
  if (state.build !== runner.value.build) { error.value = '此存档属于其他内核版本，已保留原存档'; return }
  busyAction.value = true
  await guard(async () => { await runner.value!.restore(state.data); notify('进度已读取'); paused.value = true; settingsOpen.value = false })
  busyAction.value = false
}
async function restart() {
  if (!runner.value || busy.value) return
  busyAction.value = true
  await guard(async () => { await runner.value?.reset(); paused.value = true; settingsOpen.value = false })
  busyAction.value = false
}
async function quickLoad() { await guard(async () => { await syncStates(); const state = states.value.find(state => state.kind === 'quick'); if (!state) throw new Error('此游戏还没有快速存档'); await restore(state) }) }
async function backToLibrary() {
  if (busy.value) return
  busyAction.value = true
  await guard(async () => { releaseInputs(); await runner.value?.dispose(); runner.value = null; current.value = null; paused.value = false; settingsOpen.value = false; await fullscreen.exit() })
  busyAction.value = false
}
async function leave() { if (busy.value) return; leaving.value = true; await guard(async () => { await runner.value?.dispose(); await fullscreen.exit(); await props.onLeave() }); leaving.value = false }
function back() {
  if (operation.value) { cancelOperation(); return }
  if (busy.value) return
  if (document.querySelector('dialog.game-card-menu[open]')) { (document.querySelector('dialog.game-card-menu[open]') as HTMLDialogElement).close(); return }
  const selectBackdrop = document.querySelector<HTMLElement>('.rs-backdrop')
  if (selectBackdrop) { selectBackdrop.click(); return }
  if (leaveConfirm.value) { leaveConfirm.value = false; return }
  if (settingsOpen.value && settingsPanel.value?.cancelEdit()) return
  if (editingLayout.value) { finishLayout(false); return }
  if (settingsOpen.value) { settingsOpen.value = false; return }
  if (current.value) paused.value = !paused.value
  else leaveConfirm.value = true
}
function resetLayout() { if (layoutDraft.value) layoutDraft.value[matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'] = {} }
function beginLayout() { layoutDraft.value = structuredClone(JSON.parse(JSON.stringify(settings.touchLayout)) as Layout); settingsOpen.value = false; editingLayout.value = true }
function finishLayout(save: boolean) { if (save && layoutDraft.value) settings.touchLayout = layoutDraft.value; editingLayout.value = false; layoutDraft.value = undefined; settingsTab.value = 'keys'; settingsOpen.value = true }
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (settingsOpen.value && settingsPanel.value?.captureKey(event)) return
  if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable="true"]')) return
  if (event.code === 'Escape' || event.code === 'BrowserBack') { event.preventDefault(); if (!event.repeat) back(); return }
  if (event.code === 'F11') { event.preventDefault(); if (!event.repeat) void fullscreen.toggle(); return }
  if (!current.value || busy.value || settingsOpen.value || editingLayout.value) return
  if (event.code === 'F8' || event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); if (!event.repeat) void save('quick'); return }
  if (event.code === 'F9') { event.preventDefault(); if (!event.repeat) void quickLoad(); return }
  if (!playing.value) return
  for (let player = 0; player < config.players; player++) for (const action of keyActions) if (settings.keymaps[player][action] === event.code) { event.preventDefault(); keyboardInput(player, action, true) }
}
function keyup(event: KeyboardEvent) { for (let player = 0; player < config.players; player++) for (const action of keyActions) if (settings.keymaps[player][action] === event.code) keyboardInput(player, action, false) }
let menuPressed = false
function poll() {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => !!pad)
  const menu = pads.some(pad => pad.buttons[16]?.pressed || pad.buttons[10]?.pressed && pad.buttons[11]?.pressed)
  if (playing.value && menu && !menuPressed) paused.value = true
  menuPressed = menu
  if (system === 'psp' && playing.value) {
    const deadZone = (value: number) => Math.abs(value) < .18 ? 0 : Math.max(-1, Math.min(1, value))
    padStick = [deadZone(pads[0]?.axes[0] ?? 0), deadZone(pads[0]?.axes[1] ?? 0)]
    updateStick()
  }
  if (!runner.value?.nativeInput) for (let player = 0; player < config.players; player++) for (const action of config.actions) {
    const pad = pads[player], axis = system === 'psp' ? false : action === 'left' ? (pad?.axes[0] ?? 0) < -.5 : action === 'right' ? (pad?.axes[0] ?? 0) > .5 : action === 'up' ? (pad?.axes[1] ?? 0) < -.5 : action === 'down' ? (pad?.axes[1] ?? 0) > .5 : false
    input('gamepad', player, action, !!pad?.buttons[PADMAP[action]]?.pressed || axis)
  }
  raf = requestAnimationFrame(poll)
}
function background() { visible.value = !document.hidden; if (!visible.value && current.value) paused.value = true }
function blur() { releaseInputs(); if (current.value) paused.value = true }
function pagehide() { blur(); void guard(async () => { await runner.value?.flush() }) }
function disconnected() { blur(); if (current.value) notify('手柄已断开，游戏已暂停') }
onMounted(() => {
  void guard(syncDownloads)
  void refreshCatalog()
  window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup)
  window.addEventListener('blur', blur); window.addEventListener('pagehide', pagehide); window.addEventListener('gamepaddisconnected', disconnected)
  document.addEventListener('visibilitychange', background)
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = () => { back(); return 'handled' }
  batteryTimer = setInterval(() => { if (current.value && !busy.value) void guard(async () => { await runner.value?.flush() }) }, 15000)
  raf = requestAnimationFrame(poll)
})
onBeforeUnmount(() => {
  disposed = true; cancelOperation(); refreshController?.abort(); clearInterval(batteryTimer); clearTimeout(messageTimer); cancelAnimationFrame(raf)
  releaseInputs(); void runner.value?.dispose().catch(console.error)
  window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur)
  window.removeEventListener('pagehide', pagehide); window.removeEventListener('gamepaddisconnected', disconnected); document.removeEventListener('visibilitychange', background)
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <main ref="root" class="app console-player" :class="{ 'in-game': current, 'game-playing': current || editingLayout, 'library-home': !current && !editingLayout, 'layout-editing': editingLayout }">
    <header v-show="!current && !editingLayout" class="player-toolbar" data-nav-row aria-label="游戏功能区">
      <SButton class="library-back" aria-label="返回模拟器列表" :disabled="busy" @click="leaveConfirm = true">‹ 返回</SButton>
      <span class="player-title">{{ config.name }} 模拟器</span><span class="library-header-line" aria-hidden="true"></span>
      <SButton :disabled="busy" @click="showSettings()">⚙ 设置</SButton>
    </header>
    <input ref="fileInput" type="file" hidden multiple :accept="config.extensions.map(extension => '.' + extension).join(',')" @change="importFiles" />
    <section v-show="!current && !editingLayout" class="library-browser" aria-label="游戏库">
      <section class="store-panel player-library console-library">
        <LibraryTabs v-model="tab" panel-id="console-games" :counts="counts" :local-only="!config.catalogUrl" />
        <div class="store-tools">
          <div class="search-tools">
            <SInput v-model:value="query" class="search" type="search" placeholder="搜索游戏、厂商、标签，支持拼音" aria-label="搜索游戏、厂商、标签，支持拼音全拼、首字母和混输" />
            <button v-if="config.catalogUrl" type="button" class="library-refresh" :title="refreshing ? '正在刷新游戏库…' : '刷新游戏库'" :aria-label="refreshing ? '正在刷新游戏库' : '刷新游戏库'" :aria-busy="refreshing" :disabled="refreshing || busy" @click="guard(async () => { await syncDownloads(); await refreshCatalog() })">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'is-refreshing': refreshing }" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
            </button>
          </div>
          <RemoteSelect v-model="genre" class="select" :options="genres" aria-label="游戏类型" />
          <RemoteSelect v-model="sort" class="select" :options="sortOptions" aria-label="游戏排序" />
        </div>
        <LibraryRequestStatus :loading="refreshing" :has-games="groups[tab].length > 0" :has-catalog="catalog.length > 0" :has-downloads="cacheKeys.size > 0" :failed="!!catalogError" :reason="catalogError" :disabled="busy" @retry="refreshCatalog" />
        <p v-if="error" class="library-action-error" role="alert">{{ error }}</p>
        <div id="console-games" ref="gameList" class="game-list console-games" data-nav-grid role="tabpanel" :aria-labelledby="`console-games-${tab}`">
          <article v-for="game in pageGames" :key="game.hash" class="game-card console-game" data-nav-cell>
            <GameCardActions :name="game.name" :detail="[game.genre, game.publisher].filter(Boolean).join(' · ')" :disabled="busy" :busy="operation?.name === game.name" :can-remove="cacheKeys.has(game.hash)" :can-download="!!game.download_url && !cacheKeys.has(game.hash)" :favorite="collection.isFavorite(game.hash)" @play="launch(game)" @download="launch(game, 'download')" @favorite="collection.toggleFavorite(game.hash, game)" @remove="guard(async () => { await removeGame(system, game.hash); await syncDownloads(); notify('下载缓存已移除') })" />
            <span v-if="collection.isFavorite(game.hash)" class="game-favorite-mark" aria-label="已收藏">★</span>
            <GamePreview :game-key="game.hash" :name="game.name" :screenshot="game.screenshot_url"><STag v-if="cacheKeys.has(game.hash)" size="small" type="success">已下载</STag></GamePreview>
            <div class="game-main"><div class="game-title-row"><h3>{{ game.name }}</h3></div><p v-if="game.genre || history[game.hash]?.totalPlayTimeMs" class="meta game-play-meta"><span>{{ game.genre }}</span><span v-if="history[game.hash]?.totalPlayTimeMs" class="play-time">已玩 {{ formatPlayTime(history[game.hash].totalPlayTimeMs) }}</span></p></div>
          </article>
          <SEmpty v-if="!pageGames.length && !(tab === 'online' && (refreshing || catalogError))" class="console-empty" :description="query || genre ? '没有找到匹配的游戏' : tab === 'favorites' ? '还没有收藏游戏' : tab === 'played' ? '还没有玩过或下载的游戏，可在设置中导入本地 ROM' : '暂无游戏，可刷新目录或在设置中导入本地 ROM'" />
        </div>
        <div class="store-pager">
          <span class="library-count" aria-live="polite">显示 {{ filtered.length ? (page - 1) * 50 + 1 : 0 }}–{{ Math.min(page * 50, filtered.length) }} / 共 {{ filtered.length }} 款</span>
          <nav v-if="pages > 1" class="pager-controls" aria-label="游戏库分页"><SButton class="pager-btn" :disabled="page <= 1" @click="page = 1">首页</SButton><SButton class="pager-btn" :disabled="page <= 1" @click="page--">上一页</SButton><span class="page-info" aria-label="当前页">{{ page }} / {{ pages }}</span><SButton class="pager-btn" :disabled="page >= pages" @click="page++">下一页</SButton><SButton class="pager-btn" :disabled="page >= pages" @click="page = pages">尾页</SButton></nav>
        </div>
      </section>
    </section>
    <section class="console-stage player-stage" :class="{ 'player-preparing': !current && !editingLayout }">
      <div v-if="editingLayout" class="layout-edit-tools" data-layout-toolbar><div class="layout-edit-header"><span>拖动调整位置 · 保存后生效</span><SButton @click="resetLayout">重置当前方向</SButton><SButton @click="finishLayout(false)">返回</SButton><SButton class="layout-done" @click="finishLayout(true)">保存</SButton></div></div>
      <div class="console-frame" :style="{ aspectRatio: aspect, '--console-aspect': aspect }"><canvas ref="canvas" :style="{ imageRendering: settings.smoothing ? 'auto' : 'pixelated' }" /></div>
      <button v-if="current && !editingLayout" class="play-menu-button console-pause" @click="paused = true">暂停 · Esc / 返回</button>
      <TouchControls v-if="(current || editingLayout) && (touchVisible || editingLayout) && (playing || editingLayout)" :actions="config.actions" :psp="system === 'psp'" :editing="editingLayout" :layout="layoutDraft ?? settings.touchLayout" @input="(action, down) => input('touch', 0, action, down)" @analog="touchAnalog" />
    </section>
    <SModal v-model:show="pauseOpen" class="player-pause-modal" :title="current?.name || '游戏已暂停'" subtitle="游戏已暂停" width="400px" :closable="false" :mask-closable="!busy" :close-on-esc="false"><div ref="pausePanel" class="console-pause-overlay"><PauseMenu :busy="busy" :message="error || message" @resume="paused = false" @save="save()" @load="showSettings('saves')" @settings="showSettings()" @help="showSettings('keys')" @exit="backToLibrary" /></div></SModal>
    <div v-if="(error || message) && !settingsOpen && !pauseOpen" class="console-notice" :role="error ? 'alert' : 'status'"><span>{{ error || message }}</span><SButton v-if="error" aria-label="关闭提示" @click="error = ''">×</SButton></div>
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :progress="progress" :cancelling="cancelling" @cancel="cancelOperation" />
    <BackConfirmDialog v-model:show="leaveConfirm" @confirm="leave" />
    <ConsoleSettings ref="settingsPanel" v-model:show="settingsOpen" v-model:tab="settingsTab" :system="system" :settings="settings" :states="allStates" :games="known" :current="current" :busy="busy" :error="error" @save="save()" @restore="restore" @remove="deleteSave" @rename="renameSave" @import="fileInput?.click()" @edit-layout="beginLayout" @reset-keys="player => settings.keymaps[player] = defaultKeymap(player, system)" @restart="restart" />
  </main>
</template>
