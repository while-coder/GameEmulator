<script setup lang="ts">
import { finishTextEditing } from '../../../player-ui/remoteNavigation'
import { useSettingsTab } from '../../../player-ui/useSettingsTab'
import PauseMenu from '../../../player-ui/PauseMenu.vue'
import BackConfirmDialog from '../../../player-ui/BackConfirmDialog.vue'
import { usePlaySession } from '../../../player-ui/usePlayHistory'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import {
  setLastRomName,
} from '../emulator/platform'
import { settings, type TouchLayout } from '../emulator/settings'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import { useFullscreen } from '../composables/useFullscreen'
import NesScreen from './NesScreen.vue'
import SettingsModal from './SettingsModal.vue'
import RomStorePanel from './RomStorePanel.vue'
import type { SaveState } from '../emulator/runner'
import '../../../player-ui/player.css'
import '../../../player-ui/library.css'

type ToolbarMode = 'app' | 'web'
type BackResult = 'handled'

const props = withDefaults(
  defineProps<{
    title?: string
    hint?: string
    platformLabel?: string
    libraryLabel?: string
    toolbarMode?: ToolbarMode
    storageKey?: string
    openLoadingLabel?: string
    footerHideOnTouch?: boolean
    enableBackExit?: boolean
    backOnEscape?: boolean
    onExit?: () => void | Promise<void>
  }>(),
  {
    title: 'NES/FC 模拟器',
    hint: '在游戏库中选择游戏开始游玩',
    platformLabel: 'Web 模式',
    libraryLabel: '游戏库',
    toolbarMode: 'app',
    storageKey: 'nes:lastRom',
    openLoadingLabel: '载入中...',
    footerHideOnTouch: true,
    enableBackExit: false,
    backOnEscape: false,
    onExit: undefined,
  },
)

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const appRef = ref<HTMLElement | null>(null)
// 全屏覆盖整个文档，使 ui-kit 和遥控下拉挂到 body 的弹层仍可显示。
const fullscreenRoot = computed(() => appRef.value?.ownerDocument.documentElement ?? null)
const { isFullscreen, usePseudo, toggle: toggleFullscreen, exit: exitFullscreen } = useFullscreen(fullscreenRoot)
const romName = ref<string | null>(null)
const romKey = ref<string | null>(null)
const playingRomKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const pauseOpen = ref(false)
const pauseMenu = ref<InstanceType<typeof PauseMenu> | null>(null)
useRemoteNav({ container: computed(() => pauseMenu.value?.panel ?? null), active: computed(() => navEnabled.value && pauseOpen.value && !creatingSave.value && !loading.value), autoFocus: true, priority: 10, onBack: resumeGame })
function resumeGame() {
  if (creatingSave.value || loading.value || leaving.value) return
  paused.value = false
  pauseOpen.value = false
}
function showSettings(tab?: typeof settingsTab.value) {
  if (tab) settingsTab.value = tab
  settingsOpen.value = true
  pauseOpen.value = false
}
const layoutEditing = ref(false)
const touchLayoutDraft = ref<TouchLayout>()
const leaving = ref(false)
const leaveConfirm = ref(false)
const leaveError = ref('')
const libraryPanel = ref<InstanceType<typeof RomStorePanel> | null>(null)
const libraryVisible = computed(() => !romName.value && !layoutEditing.value)
const libraryOpen = computed({ get: () => libraryVisible.value, set: () => {} })
const libraryBusy = computed(() => libraryPanel.value?.busyKey != null)
function openMenu() {
  if (romName.value) {
    saveMessage.value = ''
    pauseOpen.value = true
  } else settingsOpen.value = true
}
watch(isFullscreen, (value, previous) => {
  if (previous && !value && romName.value && !settingsOpen.value) openMenu()
})
async function launchGame(payload: { name: string; bytes: Uint8Array; key: string }) {
  await loadRomBytes(payload.name, payload.bytes, payload.key)
  settingsOpen.value = false
}
useRemoteNav({ container: appRef, active: computed(() => navEnabled.value && libraryVisible.value && !settingsOpen.value && !libraryBusy.value), autoFocus: true, priority: 1, onBack: () => props.backOnEscape ? consumeBack() : openMenu() })
async function leaveEmulator() {
  if (leaving.value || loading.value || creatingSave.value || libraryBusy.value || settingsModal.value?.busy) return
  leaving.value = true
  leaveError.value = ''
  try {
    await screen.value?.shutdown()
    await props.onExit?.()
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    leaving.value = false
  }
}
function requestLeave() {
  if (leaving.value || loading.value || creatingSave.value || libraryBusy.value || settingsModal.value?.busy) return
  leaveConfirm.value = true
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
  if (event.code === 'Escape') {
    const gameMenu = document.querySelector<HTMLDialogElement>('dialog.game-card-menu[open]')
    if (gameMenu) { event.preventDefault(); event.stopImmediatePropagation(); gameMenu.close(); return }
  }
  if (event.code === 'Escape' && settingsModal.value?.cancelRename?.()) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
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
  if (event.repeat || leaving.value || loading.value || creatingSave.value || libraryBusy.value || settingsModal.value?.busy) return
  if (event.code === 'F11') {
    void toggleFullscreen()
    return
  }
  if (leaveConfirm.value) leaveConfirm.value = false
  else if (layoutEditing.value) finishTouchLayout()
  else if (settingsOpen.value) settingsOpen.value = false
  else if (pauseOpen.value) resumeGame()
  else if (romName.value) openMenu()
  else if (props.enableBackExit && props.backOnEscape) requestLeave()
  else openMenu()
}
// Register before useRemoteNav installs its capture listener.
if (typeof window !== 'undefined') window.addEventListener('keydown', onShellKey, true)
const settingsTab = useSettingsTab('nes')

const inputLocked = computed(
  () => settingsOpen.value || pauseOpen.value || layoutEditing.value || leaving.value || leaveConfirm.value,
)

usePlaySession('nes', playingRomKey, computed(() => !!playingRomKey.value && !inputLocked.value && !paused.value && !loading.value))

const toolbarRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: toolbarRef,
  active: computed(() => navEnabled.value && !inputLocked.value && (!romName.value || paused.value)),
  autoFocus: true,
  priority: 0,
  onBack: props.enableBackExit ? () => props.backOnEscape ? consumeBack() : openMenu() : undefined,
})

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

async function loadRomBytes(name: string, bytes: Uint8Array, key: string) {
  loading.value = true
  playingRomKey.value = null
  try {
    await screen.value?.loadRom(bytes)
    playingRomKey.value = key
    romName.value = name
    romKey.value = key
    paused.value = false
    setLastRomName(name, props.storageKey)
  } finally {
    loading.value = false
  }
}

const settingsModal = ref<InstanceType<typeof SettingsModal> | null>(null)
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
      await settingsModal.value?.refreshSaves()
      saveMessage.value = '已新建存档'
    } else {
      saveMessage.value = '新建失败，请重试'
    }
  } finally {
    syncPlayback()
    creatingSave.value = false
  }
}

async function onLoadSave(payload: {
  romKey: string
  name: string
  state: SaveState
  coreBuild?: string
  bytes?: Uint8Array
}) {
  try {
    leaveError.value = ''
    if (payload.coreBuild !== screen.value?.getSaveNamespace()) throw new Error('此存档不属于当前 NES 核心版本，原存档已保留')
    if (payload.bytes) {
      await loadRomBytes(payload.name, payload.bytes, payload.romKey)
    }
    if (!await screen.value?.applyState(payload.state)) throw new Error('读取存档失败，存档可能已损坏或与当前核心不兼容')
  } catch (err) {
    leaveError.value = err instanceof Error ? err.message : String(err)
    settingsTab.value = 'saves'
    settingsOpen.value = true
  } finally {
    syncPlayback()
  }
}

function stopRom() {
  playingRomKey.value = null
  screen.value?.stop()
  romName.value = null
  romKey.value = null
  paused.value = false
  settingsOpen.value = false
  pauseOpen.value = false
  void exitFullscreen()
}

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

function handleBack(): BackResult {
  if (leaveConfirm.value) { leaveConfirm.value = false; return 'handled' }
  if (loading.value || leaving.value || creatingSave.value || libraryBusy.value || settingsModal.value?.busy) return 'handled'
  if (layoutEditing.value) {
    finishTouchLayout()
    return 'handled'
  }
  if (settingsOpen.value) {
    if (settingsModal.value?.cancelRename?.()) return 'handled'
    settingsOpen.value = false
    return 'handled'
  }
  if (pauseOpen.value) {
    resumeGame()
    return 'handled'
  }
  if (romName.value) {
    openMenu()
    return 'handled'
  }
  if (!props.enableBackExit) return 'handled'

  requestLeave()
  return 'handled'
}

function consumeBack() {
  handleBack()
}

defineExpose({
  handleBack,
  consumeBack,
  leaveEmulator,
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShellKey, true)
})
</script>

<template>
  <div
    ref="appRef"
    class="app"
    :class="[shellClasses, { 'library-home': libraryVisible, 'game-playing': !!romName && !layoutEditing }]"
  >
    <header v-show="libraryVisible || layoutEditing" ref="toolbarRef" class="player-toolbar" data-nav-row aria-label="游戏功能区">
      <SButton v-if="enableBackExit" class="library-back" aria-label="返回模拟器列表" :disabled="loading || leaving || creatingSave || libraryBusy || settingsModal?.busy" @click="requestLeave">‹ 返回</SButton>
      <span class="player-title">{{ title }}</span>
      <span class="library-header-line" aria-hidden="true"></span>
      <SButton title="打开设置 (Esc)" :disabled="libraryBusy" @click="openMenu">⚙ 设置</SButton>
    </header>
    <section v-show="libraryVisible" class="library-browser" aria-label="游戏库">
      <SHint v-if="leaveError" role="alert">{{ leaveError }}</SHint>
      <RomStorePanel ref="libraryPanel" v-model:open="libraryOpen" :launch="launchGame" />
    </section>
    <SettingsModal
      ref="settingsModal"
      v-model:open="settingsOpen"
      v-model:tab="settingsTab"
      :current-rom-key="romKey"
      :audio-on="audioOn"
      @toggle-audio="toggleAudio"
      @load-save="onLoadSave"
      @edit-touch-layout="editTouchLayout"
    >
      <template #list-actions="{ tab }">
        <SHint v-if="leaveError" role="alert">{{ leaveError }}</SHint>
        <template v-if="tab === 'saves'">
          <SButton :loading="creatingSave" :disabled="!romName || loading" @click="newSave">{{ creatingSave ? '保存中…' : '新建存档' }}</SButton>
          <SHint v-if="saveMessage" role="status">{{ saveMessage }}</SHint>
        </template>
      </template>
      <template v-if="leaveError" #actions>
        <SHint role="alert">{{ leaveError }}</SHint>
      </template>
    </SettingsModal>

    <main class="stage player-stage" :class="{ 'player-preparing': libraryVisible }">
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

    <BackConfirmDialog v-model:show="leaveConfirm" @confirm="leaveEmulator" />
    <SModal v-model:show="pauseOpen" class="player-pause-modal" title="游戏已暂停" width="400px" :closable="false" :mask-closable="!loading && !creatingSave && !leaving" :close-on-esc="false">
      <PauseMenu ref="pauseMenu" :game-name="romName || ''" :busy="loading || creatingSave || leaving" :message="saveMessage" @resume="resumeGame" @save="newSave" @load="showSettings('saves')" @help="showSettings('keys')" @settings="showSettings()" @exit="stopRom" />
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
