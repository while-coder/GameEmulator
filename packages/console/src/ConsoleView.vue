<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import ConsoleSettings from './ConsoleSettings.vue'
import { useSettingsTab } from '../../player-ui/useSettingsTab'
import LibraryLoading from '../../player-ui/LibraryLoading.vue'
import PlayerEntryError from '../../player-ui/PlayerEntryError.vue'
import PlayerSaveList from '../../player-ui/PlayerSaveList.vue'
import type { SaveListItem } from '../../player-ui/saveList'
import PauseMenu from '../../player-ui/PauseMenu.vue'
import { useLibraryOperation } from '../../player-ui/useLibraryOperation'
import { useGameCollection } from '../../player-ui/useGameCollection'
import { usePlaySession } from '../../player-ui/usePlayHistory'
import { useRemoteNav } from '../../player-ui/useRemoteNav'
import type { PlayerEntry } from '../../player-ui/playerEntry'
import { useFullscreen } from '../../player-ui/useFullscreen'
import { nextSaveLabel, type SaveKind } from '../../shared/saveSlots'
import type { TouchControlLayout } from '../../player-ui/touchLayout'
import { readTouchControl } from '../../player-ui/touchLayout'
import { acquireGame, getGame, getState, importGame, listGames, listStates, loadCatalog, putState, removeState, renameState, type Game, type Snapshot } from './store'
import { createConsoleRunner, type ConsoleRunner } from './runner'
import { gameAspect, defaultKeymap, isStickKey, keyboardActions, PADMAP, systems, type ConsoleSystem, type Action, type KeyboardAction, type StickKey, type ConsoleSettings as Settings } from './systems'
import TouchControls from './TouchControls.vue'
import '../../player-ui/library.css'
import '../../player-ui/player.css'

const props = defineProps<{ system: ConsoleSystem; onLeave: () => void | Promise<void>; entry?: PlayerEntry }>()
const system = props.system, config = systems[system]
const keyActions = keyboardActions(system)
const canvas = ref<HTMLCanvasElement | null>(null), pausePanel = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const fullscreen = useFullscreen(computed(() => document.documentElement))
const current = shallowRef<Game | null>(null), runner = shallowRef<ConsoleRunner | null>(null)
const paused = ref(false), visible = ref(!document.hidden), leaving = ref(false)
const settingsOpen = ref(false), settingsTab = useSettingsTab(system), settingsPanel = ref<InstanceType<typeof ConsoleSettings> | null>(null)
const savesOpen = ref(false)
const savePanel = ref<InstanceType<typeof PlayerSaveList> | null>(null)
const error = ref(''), message = ref('')
const busyAction = ref(false), editingLayout = ref(false), layoutDraft = ref<Layout>()
const catalog = ref<Game[]>([]), downloaded = ref<Game[]>([])
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const progress = ref<{ received: number; total: number } | null>(null)
const collection = useGameCollection<Game>(system)
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
const playing = computed(() => !!current.value && !paused.value && !settingsOpen.value && !savesOpen.value && !editingLayout.value && !busy.value && visible.value)
usePlaySession(system, computed(() => current.value?.hash ?? null), playing)
const aspect = computed(() => settings.aspect === 'auto' ? (current.value ? gameAspect(system, current.value.fileName) : config.aspect) : Number(settings.aspect.split(':')[0]) / Number(settings.aspect.split(':')[1]))
const touchVisible = computed(() => settings.touch === 'always' || settings.touch === 'auto' && !document.documentElement.classList.contains('android-tv') && matchMedia('(pointer: coarse)').matches)
const known = computed(() => [...new Map([...collection.games.value, ...downloaded.value, ...catalog.value].map(game => [game.hash, game])).values()])
const states = ref<Snapshot[]>([])
const pauseOpen = computed({ get: () => !!current.value && paused.value && !settingsOpen.value && !savesOpen.value && !editingLayout.value, set: value => { if (!value && !busy.value) paused.value = false } })
let messageTimer: ReturnType<typeof setTimeout> | undefined, batteryTimer: ReturnType<typeof setInterval> | undefined
let disposed = false, raf = 0
function notify(text: string) { message.value = text; clearTimeout(messageTimer); messageTimer = setTimeout(() => { message.value = '' }, 3500) }
async function guard(action: () => Promise<void>) { try { error.value = ''; await action() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function syncDownloads() { downloaded.value = (await listGames(system)).map(({ file: _, ...game }) => game) }
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = ''
  if (!files.length || busy.value) return
  busyAction.value = true
  await guard(async () => {
    for (const file of files) { const game = await importGame(system, file); collection.remember(game.hash, game) }
    await syncDownloads(); notify(`已导入 ${files.length} 个游戏`)
  })
  busyAction.value = false
}
function playByKey(key: string, name: string, saveKey?: string) {
  return launch({ hash: key, name, fileName: '', file_size: 0 }, async signal => {
    const knownGame = known.value.find(game => game.hash === key)
    if (knownGame?.download_url) return knownGame
    const cachedGame = await getGame(system, key)
    if (cachedGame) {
      const { file: _, ...game } = cachedGame
      return game
    }
    const game = (await loadCatalog(system, signal)).find(game => game.hash === key)
    if (!game) throw new Error('找不到此游戏，请刷新目录或重新导入 ROM')
    return game
  }, saveKey)
}
async function launch(entry: Game, resolve?: (signal: AbortSignal) => Promise<Game>, saveKey?: string) {
  if (busy.value) return false
  error.value = ''; progress.value = null
  try {
    return await runOperation(entry.name, 'play', async signal => {
      const snapshot = saveKey ? await getState(saveKey) : undefined
      if (saveKey && (!snapshot || snapshot.system !== system || snapshot.hash !== entry.hash)) {
        throw new Error('找不到此游戏的指定存档')
      }
      const game = resolve ? await resolve(signal) : entry
      signal.throwIfAborted()
      const saved = await acquireGame(system, game, signal, (received, total) => { progress.value = { received, total } })
      collection.remember(game.hash, game); await syncDownloads(); signal.throwIfAborted()
      await runner.value?.dispose(); current.value = null
      const next = await createConsoleRunner(canvas.value!, system); runner.value = next
      next.onError = reason => { paused.value = true; error.value = reason.message }
      try {
        if (snapshot && snapshot.build !== next.build) throw new Error('此存档属于其他内核版本，已保留原存档')
        await next.load(saved, signal)
        signal.throwIfAborted()
        if (snapshot) await next.restore(snapshot.data, signal)
        signal.throwIfAborted()
        current.value = game; paused.value = false; next.setMuted(settings.muted); next.setSmoothing?.(settings.smoothing)
      } catch (reason) { await next.dispose(); runner.value = null; throw reason }
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    return false
  }
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
useRemoteNav({ container: pausePanel, active: computed(() => pauseOpen.value && !busy.value), autoFocus: true, priority: 5, onBack: back })
async function syncStates() {
  states.value = current.value && runner.value ? await listStates(system, current.value.hash, runner.value.build) : []
}
function showSettings() {
  if (!disposed && !leaving.value) settingsOpen.value = true
}
async function save(kind: SaveKind = 'normal') {
  const game = current.value, active = runner.value
  if (!game || !active || busy.value) return
  busyAction.value = true
  try {
    await guard(async () => {
      await syncStates()
      let preview: Blob | undefined
      const data = await active.save(image => { preview = image })
      await putState(system, game.hash, active.build, kind, kind === 'quick' ? '快速存档' : nextSaveLabel(states.value), data, game.name, preview)
      notify('进度已保存')
    })
  } finally { busyAction.value = false }
}
async function restore(state: Snapshot, resumeAfterRestore = false) {
  if (busy.value) return
  const active = runner.value
  if (!active || state.hash !== current.value?.hash) return
  if (state.build !== active.build) throw new Error('此存档属于其他内核版本，已保留原存档')
  busyAction.value = true
  try { await active.restore(state.data); paused.value = !resumeAfterRestore }
  finally { busyAction.value = false }
  savesOpen.value = false
  notify('进度已读取')
}
async function loadSaves(): Promise<SaveListItem[]> {
  const key = current.value?.hash
  if (!key) return []
  return (await listStates(system, key)).map(state => ({
    ...state,
    compatible: !runner.value || state.build === runner.value.build,
    restore: () => restore(state, true),
    rename: label => renameState(state.key, label),
    remove: () => removeState(state),
  }))
}
async function createFromList() {
  await save()
  if (error.value) throw new Error(error.value)
}
async function restart() {
  if (!runner.value || busy.value) return
  busyAction.value = true
  await guard(async () => { await runner.value?.reset(); paused.value = true; settingsOpen.value = false })
  busyAction.value = false
}
async function quickLoad() { await guard(async () => { await syncStates(); const state = states.value.find(state => state.kind === 'quick'); if (!state) throw new Error('此游戏还没有快速存档'); await restore(state) }) }
async function leave() {
  if (busy.value) return
  leaving.value = true
  await guard(async () => {
    releaseInputs()
    await runner.value?.dispose()
    runner.value = null
    current.value = null
    paused.value = false
    settingsOpen.value = false
    await fullscreen.exit()
    await props.onLeave()
  })
  leaving.value = false
}
watch(settingsOpen, open => {
  if (!open && !current.value && !editingLayout.value && !leaving.value) void leave()
})
function back() {
  if (operation.value) { cancelOperation(); return }
  if (savesOpen.value) { savePanel.value?.back(); return }
  if (busy.value) return
  const selectBackdrop = document.querySelector<HTMLElement>('.rs-backdrop')
  if (selectBackdrop) { selectBackdrop.click(); return }
  if (settingsOpen.value && settingsPanel.value?.cancelEdit()) return
  if (editingLayout.value) { finishLayout(false); return }
  if (settingsOpen.value) { settingsOpen.value = false; return }
  if (current.value) paused.value = !paused.value
  else void leave()
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
  if (!current.value || busy.value || settingsOpen.value || savesOpen.value || editingLayout.value) return
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
  window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup)
  window.addEventListener('blur', blur); window.addEventListener('pagehide', pagehide); window.addEventListener('gamepaddisconnected', disconnected)
  document.addEventListener('visibilitychange', background)
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = () => { back(); return 'handled' }
  batteryTimer = setInterval(() => { if (current.value && !busy.value) void guard(async () => { await runner.value?.flush() }) }, 15000)
  raf = requestAnimationFrame(poll)
  const entry = props.entry
  if (entry?.kind === 'play') void playByKey(entry.key, entry.name, entry.saveKey).then(completed => {
    if (!completed && !error.value && !disposed) void leave()
  })
  else if (entry) showSettings()
  else void leave()
})
onBeforeUnmount(() => {
  disposed = true; cancelOperation(); clearInterval(batteryTimer); clearTimeout(messageTimer); cancelAnimationFrame(raf)
  releaseInputs(); void runner.value?.dispose().catch(console.error)
  window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur)
  window.removeEventListener('pagehide', pagehide); window.removeEventListener('gamepaddisconnected', disconnected); document.removeEventListener('visibilitychange', background)
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <main class="app console-player" :class="{ 'in-game': current, 'game-playing': current || editingLayout, 'layout-editing': editingLayout }">
    <input ref="fileInput" type="file" hidden multiple :accept="config.extensions.map(extension => '.' + extension).join(',')" @change="importFiles" />
    <PlayerEntryError v-if="error && !settingsOpen && !savesOpen && !current && !operation && !editingLayout" :message="error" @back="leave" />
    <section class="console-stage player-stage" :class="{ 'player-preparing': !current && !editingLayout }">
      <div v-if="editingLayout" class="layout-edit-tools" data-layout-toolbar><div class="layout-edit-header"><span>拖动调整位置 · 保存后生效</span><SButton @click="resetLayout">重置当前方向</SButton><SButton @click="finishLayout(false)">返回</SButton><SButton class="layout-done" @click="finishLayout(true)">保存</SButton></div></div>
      <div class="console-frame" :style="{ aspectRatio: aspect, '--console-aspect': aspect }"><canvas ref="canvas" :style="{ imageRendering: settings.smoothing ? 'auto' : 'pixelated' }" /></div>
      <button v-if="current && !editingLayout" class="play-menu-button console-pause" @click="paused = true">暂停 · Esc / 返回</button>
      <TouchControls v-if="(current || editingLayout) && (touchVisible || editingLayout) && (playing || editingLayout)" :actions="config.actions" :psp="system === 'psp'" :editing="editingLayout" :layout="layoutDraft ?? settings.touchLayout" @input="(action, down) => input('touch', 0, action, down)" @analog="touchAnalog" />
    </section>
    <PlayerSaveList v-if="savesOpen" ref="savePanel" :game-name="current?.name" :load="loadSaves" :create="current ? createFromList : undefined" @close="savesOpen = false" />
    <SModal v-model:show="pauseOpen" class="player-pause-modal" :title="current?.name || '游戏已暂停'" subtitle="游戏已暂停" width="400px" :closable="false" :mask-closable="!busy" :close-on-esc="false"><div ref="pausePanel" class="console-pause-overlay"><PauseMenu :busy="busy" :message="error || message" @resume="paused = false" @save="save()" @load="savesOpen = true" @settings="showSettings()" @exit="leave" /></div></SModal>
    <div v-if="current && (error || message) && !settingsOpen && !pauseOpen" class="console-notice" :role="error ? 'alert' : 'status'"><span>{{ error || message }}</span><SButton v-if="error" aria-label="关闭提示" @click="error = ''">×</SButton></div>
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :progress="progress" :cancelling="cancelling" @cancel="cancelOperation" />
    <ConsoleSettings ref="settingsPanel" v-model:show="settingsOpen" v-model:tab="settingsTab" :system="system" :settings="settings" :current="current" :busy="busy" :error="error" :message="message" @import="fileInput?.click()" @edit-layout="beginLayout" @reset-keys="player => settings.keymaps[player] = defaultKeymap(player, system)" @restart="restart" />
  </main>
</template>
