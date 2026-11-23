<script setup lang="ts">
import { finishTextEditing } from '../../../player-ui/remoteNavigation'
import { useSettingsTab } from '../../../player-ui/useSettingsTab'
import PlayerSaveList from '../../../player-ui/PlayerSaveList.vue'
import type { SaveListItem } from '../../../player-ui/saveList'
import PauseMenu from '../../../player-ui/PauseMenu.vue'
import LibraryLoading from '../../../player-ui/LibraryLoading.vue'
import PlayerEntryError from '../../../player-ui/PlayerEntryError.vue'
import { useLibraryOperation } from '../../../player-ui/useLibraryOperation'
import { useGameCollection } from '../../../player-ui/useGameCollection'
import { usePlaySession } from '../../../player-ui/usePlayHistory'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import type { PlayerEntry } from '../../../player-ui/playerEntry'
import {
  setLastRomName,
} from '../emulator/platform'
import { settings, type TouchLayout } from '../emulator/settings'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import { useFullscreen } from '../composables/useFullscreen'
import NesScreen from './NesScreen.vue'
import SettingsModal from './SettingsModal.vue'
import { acquireRomByKey } from '../store/romResolver'
import { deleteSaveStateByKey, getSaveState, listSaveStates, renameSaveState, saveKindOf } from '../store/saveState'
import type { RomEntry } from '../store/romCatalog'
import type { DownloadProgress } from '../store/romDownloader'
import type { SaveState } from '../emulator/runner'
import '../../../player-ui/player.css'
import '../../../player-ui/library.css'

const props = withDefaults(defineProps<{
  storageKey?: string
  onExit: () => void | Promise<void>
  entry?: PlayerEntry
}>(), { storageKey: 'nes:lastRom' })

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const appRef = ref<HTMLElement | null>(null)
// 全屏覆盖整个文档，使 ui-kit 和遥控下拉挂到 body 的弹层仍可显示。
const fullscreenRoot = computed(() => appRef.value?.ownerDocument.documentElement ?? null)
const { isFullscreen, usePseudo, toggle: toggleFullscreen } = useFullscreen(fullscreenRoot)
const romName = ref<string | null>(null)
const romKey = ref<string | null>(null)
const playingRomKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const pauseOpen = ref(false)
const savesOpen = ref(false)
const savePanel = ref<InstanceType<typeof PlayerSaveList> | null>(null)
const pauseMenu = ref<InstanceType<typeof PauseMenu> | null>(null)
useRemoteNav({ container: computed(() => pauseMenu.value?.panel ?? null), active: computed(() => navEnabled.value && pauseOpen.value && !savesOpen.value && !creatingSave.value && !loading.value), autoFocus: true, priority: 10, onBack: resumeGame })
function resumeGame() {
  if (creatingSave.value || loading.value || leaving.value) return
  paused.value = false
  pauseOpen.value = false
}
function showSettings() {
  settingsOpen.value = true
  pauseOpen.value = false
}
const layoutEditing = ref(false)
const touchLayoutDraft = ref<TouchLayout>()
const leaving = ref(false)
const leaveError = ref('')
const { operation, cancelling, cancelOperation, runOperation } = useLibraryOperation()
const { games: rememberedGames } = useGameCollection<RomEntry>('nes')
const progress = ref<DownloadProgress | null>(null)
const loadingMessage = ref('')

function openMenu() {
  if (romName.value) {
    saveMessage.value = ''
    pauseOpen.value = true
  } else settingsOpen.value = true
}
watch(isFullscreen, (value, previous) => {
  if (previous && !value && romName.value && !settingsOpen.value) openMenu()
})
async function launchGame(entry: Extract<PlayerEntry, { kind: 'play' }>) {
  try {
    loadingMessage.value = '正在准备游戏…'
    const completed = await runOperation(entry.name, 'play', async signal => {
      const snapshot = entry.saveKey ? await getSaveState(entry.key, entry.saveKey) : null
      if (entry.saveKey && (!snapshot || snapshot.romKey !== entry.key)) throw new Error('找不到此游戏的指定存档')
      if (snapshot && snapshot.coreBuild !== screen.value?.getSaveNamespace()) {
        throw new Error('此存档属于其他内核版本，已保留原存档')
      }
      const remembered = rememberedGames.value.find(game => game.sha256?.toLowerCase() === entry.key.toLowerCase())
      const rom = await acquireRomByKey(entry.key, {
        signal,
        onProgress: value => { progress.value = value; loadingMessage.value = '正在下载游戏…' },
      }, remembered)
      signal.throwIfAborted()
      if (!rom) throw new Error('找不到游戏文件，请回大厅刷新后重试')
      progress.value = null
      loadingMessage.value = '正在启动游戏…'
      await loadRomBytes(rom.name, rom.bytes, entry.key, signal, snapshot?.state)
    })
    if (!completed) await leaveEmulator()
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    progress.value = null
  }
}

async function leaveEmulator() {
  if (leaving.value || loading.value || creatingSave.value || operation.value) return
  leaving.value = true
  leaveError.value = ''
  try {
    await screen.value?.shutdown()
    await props.onExit()
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    leaving.value = false
  }
}
function editTouchLayout() {
  touchLayoutDraft.value = JSON.parse(JSON.stringify(settings.touchLayout))
  layoutEditing.value = true
  settingsOpen.value = false
}
function finishTouchLayout() {
  settingsOpen.value = true
  layoutEditing.value = false
  touchLayoutDraft.value = undefined
}
function saveTouchLayout() {
  if (touchLayoutDraft.value) settings.touchLayout = touchLayoutDraft.value
  finishTouchLayout()
}
function resetTouchLayout() {
  const orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
  if (touchLayoutDraft.value) touchLayoutDraft.value[orientation] = {}
}
function onShellKey(event: KeyboardEvent) {
  if (event.code === 'Escape' && navEnabled.value && finishTextEditing()) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  if (event.code === 'Escape' && event.target instanceof Element && event.target.closest('.rs-popup')) return
  if (event.code !== 'Escape' && event.code !== 'F11') return
  event.preventDefault()
  // Handle shell shortcuts before remote navigation and game input.
  event.stopImmediatePropagation()
  if (event.repeat) return
  if (event.code === 'F11') {
    if (!operation.value && !leaving.value) void toggleFullscreen()
  } else handleBack()
}
// Register before useRemoteNav installs its capture listener.
if (typeof window !== 'undefined') window.addEventListener('keydown', onShellKey, true)
const settingsTab = useSettingsTab('nes')

const inputLocked = computed(
  () => settingsOpen.value || pauseOpen.value || savesOpen.value || layoutEditing.value || leaving.value,
)

usePlaySession('nes', playingRomKey, computed(() => !!playingRomKey.value && !inputLocked.value && !paused.value && !loading.value))

// 弹窗暂停与手动暂停独立，关窗后保留原来的手动暂停状态。
function syncPlayback() {
  if (!romName.value) return
  if (inputLocked.value || paused.value || loading.value) screen.value?.pause()
  else screen.value?.resume()
}
watch([inputLocked, paused, loading, romName], syncPlayback, { flush: 'sync' })

if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.classList.toggle('tv-nav', navEnabled.value)
  })
}

const shellClasses = computed(() => ({
  'tv-nav': navEnabled.value,
  'is-fullscreen': isFullscreen.value,
  'is-pseudo-fullscreen': isFullscreen.value && usePseudo.value,
}))

async function loadRomBytes(name: string, bytes: Uint8Array, key: string, signal?: AbortSignal, state?: SaveState) {
  signal?.throwIfAborted()
  loading.value = true
  playingRomKey.value = null
  try {
    await screen.value?.loadRom(bytes, signal)
    signal?.throwIfAborted()
    if (state) {
      try {
        screen.value?.pause()
        if (!await screen.value?.applyState(state, signal)) throw new Error('读取存档失败，存档可能已损坏或与当前核心不兼容')
      } catch (error) {
        screen.value?.stop()
        throw error
      }
    }
    signal?.throwIfAborted()
    playingRomKey.value = key
    romName.value = name
    romKey.value = key
    paused.value = false
    setLastRomName(name, props.storageKey)
  } finally {
    loading.value = false
  }
}

const creatingSave = ref(false)
const saveMessage = ref('')
watch(settingsOpen, (open) => { if (open) saveMessage.value = '' })
async function newSave() {
  if (creatingSave.value) return
  creatingSave.value = true
  saveMessage.value = ''
  try {
    const saved = await screen.value?.quickNewSave()
    if (saved) {
      saveMessage.value = '已新建存档'
    } else {
      saveMessage.value = '新建失败，请重试'
    }
  } finally {
    syncPlayback()
    creatingSave.value = false
  }
}

async function loadSaves(): Promise<SaveListItem[]> {
  const key = romKey.value
  if (!key) return []
  return (await listSaveStates(key)).map(record => ({
    ...record,
    label: record.label?.trim() || (saveKindOf(record) === 'quick' ? '快速存档' : record.name),
    kind: saveKindOf(record),
    compatible: record.coreBuild === screen.value?.getSaveNamespace(),
    rename: label => renameSaveState(record.key, label),
    remove: () => deleteSaveStateByKey(record.key),
    restore: async () => {
      if (record.coreBuild !== screen.value?.getSaveNamespace()) throw new Error('此存档属于其他内核版本')
      if (!await screen.value?.applyState(record.state)) throw new Error('读取存档失败，存档可能已损坏')
      savesOpen.value = false
      resumeGame()
    },
  }))
}
async function createFromList() {
  await newSave()
  if (saveMessage.value !== '已新建存档') throw new Error(saveMessage.value || '新建存档失败')
}

watch(settingsOpen, open => {
  if (!open && !romName.value && !layoutEditing.value && !loading.value) void leaveEmulator()
})
onMounted(() => {
  const entry = props.entry
  if (entry?.kind === 'play') void launchGame(entry)
  else if (entry) showSettings()
  else void leaveEmulator()
})

function toggleAudio() {
  audioOn.value = !audioOn.value
  screen.value?.setAudioEnabled(audioOn.value)
}

function onSystemAction(action: string) {
  if (action === 'pause') openMenu()
  if (action === 'open-settings') {
    showSettings()
  }
}

function handleBack(): 'handled' {
  if (operation.value) { cancelOperation(); return 'handled' }
  if (savesOpen.value) { savePanel.value?.back(); return 'handled' }
  if (loading.value || leaving.value || creatingSave.value) return 'handled'
  const filter = document.querySelector<HTMLElement>('.rs-backdrop')
  if (filter) { filter.click(); return 'handled' }
  if (layoutEditing.value) finishTouchLayout()
  else if (settingsOpen.value) settingsOpen.value = false
  else if (pauseOpen.value) resumeGame()
  else if (romName.value) openMenu()
  else void leaveEmulator()
  return 'handled'
}

defineExpose({ handleBack })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShellKey, true)
})
</script>

<template>
  <div
    ref="appRef"
    class="app"
    :class="[shellClasses, { 'game-playing': !!romName || layoutEditing }]"
  >
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action" :message="loadingMessage"
      :progress="progress" :cancelling="cancelling" @cancel="cancelOperation" />
    <PlayerEntryError v-if="leaveError && !settingsOpen && !savesOpen && !romName && !operation && !layoutEditing" :message="leaveError" @back="leaveEmulator" />
    <SettingsModal
      v-model:open="settingsOpen"
      v-model:tab="settingsTab"
      :audio-on="audioOn"
      @toggle-audio="toggleAudio"
      @edit-touch-layout="editTouchLayout"
    >
      <template v-if="leaveError" #actions>
        <SHint role="alert">{{ leaveError }}</SHint>
      </template>
    </SettingsModal>

    <main class="stage player-stage" :class="{ 'player-preparing': !romName && !layoutEditing }">
      <div v-if="layoutEditing" class="layout-edit-tools" data-layout-toolbar>
        <div class="layout-edit-header">
          <span>拖动调整位置 · 保存后生效</span>
          <SButton @click="resetTouchLayout">重置当前方向</SButton>
          <SButton @click="finishTouchLayout">返回</SButton>
          <SButton class="layout-done" @click="saveTouchLayout">保存</SButton>
        </div>
      </div>
      <NesScreen
        ref="screen"
        :input-locked="inputLocked"
        :layout-editing="layoutEditing"
        :touch-layout-draft="touchLayoutDraft"
        :game-paused="paused || loading"

        :rom-key="romKey"
        :rom-name="romName"
        @system-action="onSystemAction"
      />
    </main>

    <PlayerSaveList v-if="savesOpen" ref="savePanel" :game-name="romName" :load="loadSaves" :create="romName ? createFromList : undefined" @close="savesOpen = false" />
    <SModal v-if="!savesOpen" v-model:show="pauseOpen" class="player-pause-modal" :title="romName || '游戏已暂停'" subtitle="游戏已暂停" width="400px" :closable="false" :mask-closable="!loading && !creatingSave && !leaving" :close-on-esc="false">
      <PauseMenu ref="pauseMenu" :busy="loading || creatingSave || leaving" :message="saveMessage" @resume="resumeGame" @save="newSave" @load="savesOpen = true" @settings="showSettings()" @exit="leaveEmulator" />
    </SModal>
    <button v-if="romName && !layoutEditing" class="play-menu-button" @click="openMenu">暂停 · Esc / 返回</button>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
html,
body,
#app {
  margin: 0;
  height: 100%;
}
body {
  background: #1a1a1a;
  color: #e8e8e8;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.tv-nav :focus-visible,
.tv-nav button:focus,
.tv-nav a:focus,
.tv-nav input:focus,
.tv-nav select:focus,
.tv-nav textarea:focus,
.tv-nav [tabindex]:focus,
.tv-nav [data-nav]:focus {
  outline: 3px solid #4ea1ff;
  outline-offset: 2px;
  border-radius: 6px;
}
</style>

<style scoped>
.app {
  height: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
}
.app.is-pseudo-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2000;
}
.app.is-fullscreen :deep(.frame) {
  border-radius: 0;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
</style>
