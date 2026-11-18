<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
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
import { gameAspect, KEYMAP, PADMAP, systems, type ConsoleSystem, type Action } from './systems'
import TouchControls from './TouchControls.vue'
import mgbaLicense from './assets/MGBA-LICENSE.txt?raw'
import snesLicense from './assets/SNES9X-LICENSE.txt?raw'
import retroarchLicense from '../../arcade/src/assets/cores/RETROARCH-COPYING.txt?raw'
import '../../player-ui/library.css'
import '../../player-ui/player.css'

const props = defineProps<{ system: ConsoleSystem; onLeave: () => void | Promise<void> }>()
const system = props.system, config = systems[system]
const root = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null), dialog = ref<HTMLDialogElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const fullscreen = useFullscreen(computed(() => document.documentElement))
const current = shallowRef<Game | null>(null), runner = shallowRef<ConsoleRunner | null>(null)
const paused = ref(false), visible = ref(!document.hidden), leaving = ref(false), leaveConfirm = ref(false)
const modal = ref<'settings' | 'saves' | 'help' | 'rename' | null>(null), error = ref(''), message = ref('')
const busyAction = ref(false), editingLayout = ref(false), layoutDraft = ref<Layout>()
const catalog = ref<Game[]>([]), downloaded = ref<Game[]>([]), refreshing = ref(false), catalogError = ref('')
const tab = ref<'online' | 'played' | 'favorites'>('online')
const { query, genre, sort, page, gameList } = useLibraryBrowser(system, tab)
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const progress = ref<{ received: number; total: number } | null>(null)
const { history } = usePlayHistory(system), collection = useGameCollection<Game>(system)
const sourceKey = `console:${system}:source`, catalogKey = `console:${system}:catalog`, settingsKey = `console:${system}:settings`
type Layout = Record<'portrait' | 'landscape', Partial<Record<string, TouchControlLayout>>>
type Settings = { muted: boolean; smoothing: boolean; touch: 'auto' | 'always' | 'never'; keymaps: Record<Action, string>[]; touchLayout: Layout }
const settings = reactive<Settings>({ muted: false, smoothing: false, touch: 'auto', keymaps: [{ ...KEYMAP }, { ...KEYMAP, up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', a: 'KeyV', b: 'KeyC', x: 'KeyF', y: 'KeyD', l: 'KeyU', r: 'KeyO', start: 'KeyG', select: 'KeyT' }], touchLayout: { portrait: {}, landscape: {} } })
const source = ref('')
try {
  source.value = localStorage.getItem(sourceKey) ?? ''
  const cached: unknown = JSON.parse(localStorage.getItem(catalogKey) ?? '[]')
  if (Array.isArray(cached)) catalog.value = cached.filter(game => game && typeof game.hash === 'string' && typeof game.name === 'string')
  const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null')
  if (saved) {
    settings.muted = saved.muted === true; settings.smoothing = saved.smoothing === true
    if (['auto', 'always', 'never'].includes(saved.touch)) settings.touch = saved.touch
    for (let player = 0; player < config.players; player++) for (const action of config.actions) {
      const code = saved.keymaps?.[player]?.[action]
      if (typeof code === 'string' && code.length < 40) settings.keymaps[player][action] = code
    }
    for (const orientation of ['portrait', 'landscape'] as const) for (const [key, value] of Object.entries(saved.touchLayout?.[orientation] ?? {})) {
      const layout = readTouchControl(value)
      if (layout && (key === 'dpad' || config.actions.includes(key as Action))) settings.touchLayout[orientation][key] = layout
    }
  }
} catch { /* Use defaults if storage is unavailable or damaged. */ }
watch(settings, value => { try { localStorage.setItem(settingsKey, JSON.stringify(value)) } catch { error.value = '设置无法保存，请检查设备存储空间' } }, { deep: true })
const busy = computed(() => !!operation.value || busyAction.value || leaving.value)
const playing = computed(() => !!current.value && !paused.value && !modal.value && !editingLayout.value && !busy.value && !leaveConfirm.value && visible.value)
usePlaySession(system, computed(() => current.value?.hash ?? null), playing)
const aspect = computed(() => current.value ? gameAspect(system, current.value.fileName) : config.aspect)
const touchVisible = computed(() => settings.touch === 'always' || settings.touch === 'auto' && !document.documentElement.classList.contains('android-tv') && matchMedia('(pointer: coarse)').matches)
const cacheKeys = computed(() => new Set(downloaded.value.map(game => game.hash)))
const known = computed(() => [...new Map([...collection.games.value, ...downloaded.value, ...catalog.value].map(game => [game.hash, game])).values()])
const groups = computed(() => ({ online: catalog.value, played: known.value.filter(game => cacheKeys.value.has(game.hash) || !!history.value[game.hash]), favorites: known.value.filter(game => collection.isFavorite(game.hash)) }))
const counts = computed(() => ({ online: groups.value.online.length, played: groups.value.played.length, favorites: groups.value.favorites.length }))
const genres = computed(() => [{ value: '', label: '全部类型' }, ...[...new Set(groups.value[tab.value].map(game => game.genre).filter((value): value is string => !!value))].sort().map(value => ({ value, label: value }))])
const filtered = computed(() => {
  const matches = createGameSearch(query.value)
  const games = groups.value[tab.value].filter(game => (!genre.value || game.genre === genre.value) && matches([game.name, game.publisher, game.genre, ...(game.tags ?? [])]))
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
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 24)))
const pageGames = computed(() => filtered.value.slice((page.value - 1) * 24, page.value * 24))
watch(pages, count => { if (page.value > count) page.value = count })
const sortOptions = [{ value: 'default', label: '默认排序' }, { value: 'recent', label: '最近游玩' }, { value: 'name-asc', label: '名称升序' }, { value: 'name-desc', label: '名称降序' }, { value: 'size-asc', label: '大小升序' }, { value: 'size-desc', label: '大小降序' }, { value: 'publisher', label: '厂商' }]
const states = ref<Snapshot[]>([]), renaming = shallowRef<Snapshot | null>(null), renameLabel = ref('')
const keyPlayer = ref('0'), capturing = ref<Action | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | undefined, batteryTimer: ReturnType<typeof setInterval> | undefined
let refreshController: AbortController | undefined, disposed = false, raf = 0
function notify(text: string) { message.value = text; clearTimeout(messageTimer); messageTimer = setTimeout(() => { message.value = '' }, 3500) }
async function guard(action: () => Promise<void>) { try { error.value = ''; await action() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function syncDownloads() { downloaded.value = (await listGames(system)).map(({ file: _, ...game }) => game) }
async function refreshCatalog() {
  if (refreshing.value) return
  if (!source.value.trim()) { catalogError.value = ''; return }
  refreshing.value = true; catalogError.value = ''; refreshController = new AbortController()
  try {
    const address = source.value.trim(), games = await loadCatalog(system, address, refreshController.signal)
    if (disposed) return
    catalog.value = games
    try { localStorage.setItem(sourceKey, address); localStorage.setItem(catalogKey, JSON.stringify(games)) } catch { notify('目录已更新，但无法缓存到本地') }
    await syncDownloads(); notify('游戏目录已更新')
  } catch (reason) { if (!disposed) catalogError.value = `${reason instanceof Error ? reason.message : String(reason)}${catalog.value.length ? '；正在显示缓存目录' : ''}` }
  finally { refreshing.value = false }
}
async function applySource() {
  if (!source.value.trim()) {
    catalog.value = []; catalogError.value = ''
    try { localStorage.removeItem(sourceKey); localStorage.removeItem(catalogKey) } catch { /* Current session remains usable. */ }
    notify('已清除在线游戏源'); return
  }
  await refreshCatalog()
}
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = ''
  if (!files.length || busy.value) return
  busyAction.value = true
  await guard(async () => {
    for (const file of files) { const game = await importGame(system, file); collection.remember(game.hash, game) }
    await syncDownloads(); tab.value = 'played'; notify(`已导入 ${files.length} 个游戏`)
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
      const next = createConsoleRunner(canvas.value!, system); runner.value = next
      next.onError = reason => { paused.value = true; error.value = reason.message }
      try {
        await next.load(saved, signal); signal.throwIfAborted()
        current.value = game; paused.value = false; next.setMuted(settings.muted); next.setSmoothing?.(settings.smoothing)
        // Enter before the loading operation ends; Vue resumes only after the overlay closes.
        await fullscreen.enter()
      } catch (reason) { await next.dispose(); runner.value = null; throw reason }
    })
  })
}
const sources = new Map<string, Set<string>>()
function input(sourceId: string, player: number, action: Action, down: boolean) {
  const key = `${player}:${action}`, held = sources.get(key) ?? new Set<string>(), previous = held.size > 0
  if (down && playing.value) held.add(sourceId); else held.delete(sourceId)
  if (held.size) sources.set(key, held); else sources.delete(key)
  if (previous !== (held.size > 0)) runner.value?.input(player, action, held.size > 0)
}
function releaseInputs() {
  for (const key of sources.keys()) { const [player, action] = key.split(':'); runner.value?.input(Number(player), action as Action, false) }
  sources.clear()
}
watch(playing, value => {
  releaseInputs()
  if (value) runner.value?.resume()
  else { runner.value?.pause(); if (current.value) void guard(async () => { await runner.value?.flush() }) }
}, { flush: 'sync' })
watch(() => settings.muted, value => runner.value?.setMuted(value))
watch(() => settings.smoothing, value => runner.value?.setSmoothing?.(value))
watch(modal, async value => {
  capturing.value = null
  await nextTick()
  if (disposed) return
  if (value && !dialog.value?.open) dialog.value?.showModal()
  else if (!value) dialog.value?.close()
})
watch(fullscreen.isFullscreen, (value, previous) => { if (previous && !value && current.value) paused.value = true })
useRemoteNav({ container: root, active: computed(() => !playing.value && !modal.value && !busy.value && !leaveConfirm.value && !editingLayout.value), autoFocus: true, onBack: back })
useRemoteNav({ container: dialog, active: computed(() => !!modal.value && !busy.value), autoFocus: true, priority: 10, onBack: back })
async function syncStates() { states.value = current.value && runner.value ? await listStates(system, current.value.hash, runner.value.build) : [] }
async function openSaves() { await guard(syncStates); modal.value = 'saves' }
async function save(kind: SaveKind = 'normal') {
  if (!current.value || !runner.value || busy.value) return
  busyAction.value = true
  await guard(async () => {
    await syncStates()
    await putState(system, current.value!.hash, runner.value!.build, kind, kind === 'quick' ? '快速存档' : nextSaveLabel(states.value), await runner.value!.save())
    await syncStates(); notify('进度已保存')
  })
  busyAction.value = false
}
async function restore(state: Snapshot) {
  if (!runner.value || state.hash !== current.value?.hash || state.build !== runner.value.build || busy.value) return
  busyAction.value = true
  await guard(async () => { await runner.value!.restore(state.data); notify('进度已读取'); modal.value = null; paused.value = true })
  busyAction.value = false
}
async function quickLoad() { await guard(async () => { await syncStates(); const state = states.value.find(state => state.kind === 'quick'); if (!state) throw new Error('此游戏还没有快速存档'); await restore(state) }) }
async function backToLibrary() {
  if (busy.value) return
  busyAction.value = true
  await guard(async () => { releaseInputs(); await runner.value?.dispose(); runner.value = null; current.value = null; paused.value = false; modal.value = null; await fullscreen.exit() })
  busyAction.value = false
}
async function leave() { if (busy.value) return; leaving.value = true; await guard(async () => { await runner.value?.dispose(); await fullscreen.exit(); await props.onLeave() }); leaving.value = false }
function back() {
  if (operation.value) { cancelOperation(); return }
  if (busy.value) return
  if (document.querySelector('dialog.game-card-menu[open]')) { (document.querySelector('dialog.game-card-menu[open]') as HTMLDialogElement).close(); return }
  if (leaveConfirm.value) { leaveConfirm.value = false; return }
  if (capturing.value) { capturing.value = null; return }
  if (editingLayout.value) { finishLayout(false); return }
  if (modal.value) { modal.value = modal.value === 'rename' ? 'saves' : null; return }
  if (current.value) paused.value = !paused.value
  else leaveConfirm.value = true
}
function beginLayout() { layoutDraft.value = structuredClone(JSON.parse(JSON.stringify(settings.touchLayout)) as Layout); modal.value = null; editingLayout.value = true }
function finishLayout(save: boolean) { if (save && layoutDraft.value) settings.touchLayout = layoutDraft.value; editingLayout.value = false; layoutDraft.value = undefined; modal.value = 'settings' }
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (capturing.value) {
    event.preventDefault(); event.stopImmediatePropagation()
    if (event.code !== 'Escape') {
      const map = settings.keymaps[Number(keyPlayer.value)]
      for (const action of config.actions) if (map[action] === event.code) map[action] = ''
      map[capturing.value] = event.code
    }
    capturing.value = null; return
  }
  if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable="true"]')) return
  if (event.code === 'Escape' || event.code === 'BrowserBack') { event.preventDefault(); if (!event.repeat) back(); return }
  if (event.code === 'F11') { event.preventDefault(); if (!event.repeat) void fullscreen.toggle(); return }
  if (!current.value || busy.value || modal.value || editingLayout.value) return
  if (event.code === 'F8' || event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); if (!event.repeat) void save('quick'); return }
  if (event.code === 'F9') { event.preventDefault(); if (!event.repeat) void quickLoad(); return }
  if (!playing.value) return
  for (let player = 0; player < config.players; player++) for (const action of config.actions) if (settings.keymaps[player][action] === event.code) { event.preventDefault(); input('keyboard', player, action, true) }
}
function keyup(event: KeyboardEvent) { for (let player = 0; player < config.players; player++) for (const action of config.actions) if (settings.keymaps[player][action] === event.code) input('keyboard', player, action, false) }
let menuPressed = false
function poll() {
  const pads = Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad => !!pad)
  const menu = pads.some(pad => pad.buttons[16]?.pressed || pad.buttons[10]?.pressed && pad.buttons[11]?.pressed)
  if (playing.value && menu && !menuPressed) paused.value = true
  menuPressed = menu
  if (!runner.value?.nativeInput) for (let player = 0; player < config.players; player++) for (const action of config.actions) {
    const pad = pads[player], axis = action === 'left' ? (pad?.axes[0] ?? 0) < -.5 : action === 'right' ? (pad?.axes[0] ?? 0) > .5 : action === 'up' ? (pad?.axes[1] ?? 0) < -.5 : action === 'down' ? (pad?.axes[1] ?? 0) > .5 : false
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
  if (source.value) void refreshCatalog()
  window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup)
  window.addEventListener('blur', blur); window.addEventListener('pagehide', pagehide); window.addEventListener('gamepaddisconnected', disconnected)
  document.addEventListener('visibilitychange', background)
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = () => { back(); return 'handled' }
  batteryTimer = setInterval(() => { if (current.value && !busy.value) void guard(async () => { await runner.value?.flush() }) }, 15000)
  raf = requestAnimationFrame(poll)
})
onBeforeUnmount(() => {
  disposed = true; cancelOperation(); refreshController?.abort(); clearInterval(batteryTimer); clearTimeout(messageTimer); cancelAnimationFrame(raf)
  releaseInputs(); void runner.value?.dispose().catch(console.error); dialog.value?.close()
  window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur)
  window.removeEventListener('pagehide', pagehide); window.removeEventListener('gamepaddisconnected', disconnected); document.removeEventListener('visibilitychange', background)
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <main ref="root" class="console-player" :class="{ 'in-game': current, 'layout-editing': editingLayout }">
    <header v-if="!current" class="console-toolbar">
      <button :disabled="busy" @click="leaveConfirm = true">← 返回</button><h1>{{ config.name }}</h1>
      <button :disabled="busy" @click="fileInput?.click()">导入游戏</button><button :disabled="busy" @click="modal = 'settings'">设置</button>
    </header>
    <input ref="fileInput" type="file" hidden multiple :accept="config.extensions.map(extension => '.' + extension).join(',')" @change="importFiles" />
    <section v-show="!current" class="console-library">
      <LibraryTabs v-model="tab" panel-id="console-games" :counts="counts" />
      <div class="console-filters">
        <input v-model="query" type="search" placeholder="搜索游戏 / 拼音" aria-label="搜索游戏" />
        <RemoteSelect v-model="genre" :options="genres" aria-label="类型" />
        <RemoteSelect v-model="sort" :options="sortOptions" aria-label="排序" />
        <button :disabled="refreshing || busy" aria-label="刷新游戏库" @click="guard(async () => { await syncDownloads(); await refreshCatalog() })">{{ refreshing ? '…' : '↻' }}</button>
      </div>
      <p v-if="catalogError && tab === 'online'" role="alert">{{ catalogError }} <button @click="refreshCatalog">重试</button></p>
      <div id="console-games" ref="gameList" class="console-games" data-nav-grid role="tabpanel" :aria-labelledby="`console-games-${tab}`">
        <article v-for="game in pageGames" :key="game.hash" class="game-card console-game" data-nav-cell><GameCardActions :name="game.name" :detail="`${(game.file_size / 1024 / 1024).toFixed(1)} MB`" :disabled="busy" :busy="false" :can-remove="cacheKeys.has(game.hash)" :can-download="!!game.download_url && !cacheKeys.has(game.hash)" :favorite="collection.isFavorite(game.hash)" @play="launch(game)" @download="launch(game, 'download')" @favorite="collection.toggleFavorite(game.hash, game)" @remove="guard(async () => { await removeGame(system, game.hash); await syncDownloads(); notify('下载缓存已移除') })" />
          <GamePreview :game-key="game.hash" :name="game.name" :screenshot="game.screenshot_url"><span v-if="cacheKeys.has(game.hash)" class="console-cache-badge">已下载</span></GamePreview>
          <strong>{{ game.name }}</strong><span v-if="collection.isFavorite(game.hash)" class="game-favorite-mark" aria-label="已收藏">★</span><span>{{ game.genre || game.fileName.split('.').pop()?.toUpperCase() }} · {{ (game.file_size / 1024 / 1024).toFixed(1) }} MB</span>
          <span v-if="history[game.hash]">游玩 {{ formatPlayTime(history[game.hash].totalPlayTimeMs) }}</span>
        </article>
        <div v-if="!pageGames.length && !refreshing && !catalogError" class="console-empty">
          <template v-if="tab === 'online' && !source"><h2>添加你的游戏</h2><p>导入本地 {{ config.extensions.map(extension => '.' + extension).join(' / ') }} 文件，或在设置中填写在线游戏目录地址。</p><button @click="fileInput?.click()">导入游戏</button><button @click="modal = 'settings'">设置游戏源</button></template>
          <p v-else>{{ query || genre ? '没有找到匹配的游戏' : tab === 'favorites' ? '还没有收藏游戏' : '暂无游戏，可先导入本地 ROM' }}</p>
        </div>
      </div>
      <nav v-if="pages > 1" class="console-pagination" aria-label="分页"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" @click="page++">下一页</button></nav>
    </section>
    <section v-show="current" class="console-stage">
      <div class="console-frame" :style="{ aspectRatio: aspect, '--console-aspect': aspect }"><canvas ref="canvas" :style="{ imageRendering: settings.smoothing ? 'auto' : 'pixelated' }" /></div>
      <button v-if="!paused && !editingLayout" class="console-pause" aria-label="暂停游戏" @click="paused = true">Ⅱ</button>
      <TouchControls v-if="current && (touchVisible || editingLayout) && (!paused && !modal || editingLayout)" :actions="config.actions" :editing="editingLayout" :layout="layoutDraft ?? settings.touchLayout" @input="(action, down) => input('touch', 0, action, down)" />
      <div v-if="paused && !modal && !editingLayout" class="console-pause-overlay"><h2>{{ current?.name }}</h2><PauseMenu :busy="busy" :message="message" @resume="paused = false" @save="save()" @load="openSaves" @settings="modal = 'settings'" @help="modal = 'help'" @exit="backToLibrary" /></div>
      <div v-if="editingLayout" class="console-layout-tools layout-edit-tools"><span>拖动控件调整位置</span><button @click="finishLayout(true)">保存布局</button><button @click="finishLayout(false)">放弃修改</button><button @click="layoutDraft = { portrait: {}, landscape: {} }">重置布局</button></div>
    </section>
    <div v-if="error || message" class="console-notice" :role="error ? 'alert' : 'status'"><span>{{ error || message }}</span><button v-if="error" aria-label="关闭提示" @click="error = ''">×</button></div>
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :progress="progress" :cancelling="cancelling" @cancel="cancelOperation" />
    <BackConfirmDialog v-model:show="leaveConfirm" @confirm="leave" />
    <Teleport to="body">
      <dialog ref="dialog" class="console-dialog" @cancel.prevent="back">
        <header><h2>{{ modal === 'settings' ? '设置' : modal === 'saves' ? '存档' : modal === 'rename' ? '重命名存档' : '操作说明' }}</h2><button :disabled="busy" aria-label="关闭" @click="back">×</button></header>
        <fieldset :disabled="busy">
          <template v-if="modal === 'settings'">
            <h3>游戏源</h3><label>目录地址<input v-model="source" type="url" placeholder="https://…/catalog.json" /></label><button :disabled="refreshing" @click="applySource">{{ refreshing ? '正在读取…' : '应用并刷新' }}</button><p v-if="catalogError" role="alert">{{ catalogError }}</p>
            <h3>显示与声音</h3><label><input v-model="settings.muted" type="checkbox" />静音</label><label><input v-model="settings.smoothing" type="checkbox" />平滑显示</label>
            <label>触屏按键<RemoteSelect v-model="settings.touch" :options="[{ value: 'auto', label: '自动' }, { value: 'always', label: '始终显示' }, { value: 'never', label: '隐藏' }]" /></label><button v-if="current" @click="beginLayout">编辑触屏布局</button>
            <h3>键盘</h3><RemoteSelect v-if="config.players > 1" v-model="keyPlayer" :options="[{ value: '0', label: '玩家 1' }, { value: '1', label: '玩家 2' }]" aria-label="玩家" />
            <div class="console-keymap"><button v-for="action in config.actions" :key="action" @click="capturing = action">{{ action.toUpperCase() }}：{{ capturing === action ? '请按键…' : settings.keymaps[Number(keyPlayer)][action] || '未绑定' }}</button></div>
            <p>手柄使用标准布局；左摇杆或方向键移动，L/R 对应肩键。Esc / 返回键暂停，手柄也可同时按 L3 + R3 暂停。</p>
            <button v-if="current" @click="guard(async () => { runner?.reset(); paused = true; modal = null })">重新开始</button>
            <details><summary>开源许可</summary><pre>{{ system === 'gba' ? mgbaLicense : snesLicense }}\n{{ retroarchLicense }}</pre></details>
          </template>
          <template v-else-if="modal === 'saves'">
            <button @click="save()">新建存档</button><p v-if="!states.length">当前游戏和内核还没有存档</p>
            <article v-for="state in states" :key="state.key" class="console-state"><div><strong>{{ state.label }}</strong><small>{{ new Date(state.savedAt).toLocaleString() }}</small></div><button @click="restore(state)">读取</button><button @click="renaming = state; renameLabel = state.label; modal = 'rename'">重命名</button><button @click="guard(async () => { await removeState(state); await syncStates() })">删除</button></article>
          </template>
          <template v-else-if="modal === 'rename'"><label>存档名称<input v-model="renameLabel" maxlength="80" @keydown.enter="guard(async () => { if (renaming && renameLabel.trim()) { await renameState(renaming, renameLabel.trim()); await syncStates(); modal = 'saves' } })" /></label><button :disabled="!renameLabel.trim()" @click="guard(async () => { if (renaming) { await renameState(renaming, renameLabel.trim()); await syncStates(); modal = 'saves' } })">保存名称</button></template>
          <template v-else-if="modal === 'help'"><p>方向键移动，X / Z 对应 A / B，Q / W 对应 L / R，Enter 开始，右 Shift 选择。SFC 的 S / A 对应 X / Y。可在设置中修改。</p><p>Esc / 返回键暂停，F11 全屏，Ctrl+S / F8 保存快速存档，F9 读取快速存档。暂停菜单保存进度会新增普通存档。</p><p>游戏内存档自动保存在本机。即时存档按游戏、平台及内核版本隔离。{{ system === 'gba' ? '当前支持单机游玩，不支持掌机联机。' : '支持两个标准手柄。' }}</p></template>
        </fieldset>
      </dialog>
    </Teleport>
  </main>
</template>
