<script setup lang="ts">
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  isTauri,
  pickRomFile,
  setLastRomName,
} from '../emulator/platform'
import { settings } from '../emulator/settings'
import { sha256Hex } from '../store/romDownloader'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import { useFullscreen } from '../composables/useFullscreen'
import NesScreen from './NesScreen.vue'
import SettingsModal from './SettingsModal.vue'
import ShortcutsPanel from './ShortcutsPanel.vue'
import PlayerFooter from './PlayerFooter.vue'
import type { SaveState } from '../emulator/runner'

type ToolbarMode = 'app' | 'web'
type BackResult = 'exit' | 'handled'

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
    onExit?: () => void | Promise<void>
  }>(),
  {
    title: 'NES/FC 模拟器',
    hint: '打开本地 .nes 文件开始游戏',
    platformLabel: 'Web 模式',
    libraryLabel: '游戏库',
    toolbarMode: 'app',
    storageKey: 'nes:lastRom',
    openLoadingLabel: '载入中...',
    footerHideOnTouch: true,
    enableBackExit: false,
    onExit: undefined,
  },
)

const screen = ref<InstanceType<typeof NesScreen> | null>(null)
const appRef = ref<HTMLElement | null>(null)
// 全屏覆盖整个文档，使 ui-kit 和遥控下拉挂到 body 的弹层仍可显示。
const fullscreenRoot = computed(() => appRef.value?.ownerDocument.documentElement ?? null)
const { isFullscreen, usePseudo, toggle: toggleFullscreen } = useFullscreen(fullscreenRoot)
const romName = ref<string | null>(null)
const romKey = ref<string | null>(null)
const audioOn = ref(true)
const loading = ref(false)
const paused = ref(false)
const settingsOpen = ref(false)
const layoutEditing = ref(false)
function editTouchLayout() {
  layoutEditing.value = true
  settingsOpen.value = false
}
function finishTouchLayout() {
  settingsOpen.value = true
  layoutEditing.value = false
}
function resetTouchLayout() {
  const orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
  settings.touchLayout[orientation] = {}
}
function onLayoutKey(event: KeyboardEvent) {
  if (!layoutEditing.value || event.code !== 'Escape') return
  event.preventDefault()
  finishTouchLayout()
}
onMounted(() => window.addEventListener('keydown', onLayoutKey))
const settingsTab = ref<'library' | 'saves' | 'keys' | 'display' | 'audio' | 'misc'>('library')
function openSettings(tab: typeof settingsTab.value) {
  settingsTab.value = tab
  settingsOpen.value = true
}
const helpOpen = ref(false)
const exitHintVisible = ref(false)
let exitArmedAt = 0
let exitHintTimer: ReturnType<typeof setTimeout> | null = null

const inputLocked = computed(
  () => settingsOpen.value || helpOpen.value || layoutEditing.value,
)

const toolbarRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: toolbarRef,
  active: computed(() => navEnabled.value && !inputLocked.value && (!romName.value || paused.value)),
  autoFocus: true,
  priority: 0,
  onBack: props.enableBackExit ? consumeBack : undefined,
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

const modKey: 'ctrl' | 'shift' = isTauri ? 'ctrl' : 'shift'
const shellClasses = computed(() => ({
  'tv-nav': navEnabled.value,
  'is-fullscreen': isFullscreen.value,
  'is-pseudo-fullscreen': isFullscreen.value && usePseudo.value,
}))

async function openRom() {
  const picked = await pickRomFile()
  if (!picked) return
  const key = await sha256Hex(picked.bytes)
  await loadRomBytes(picked.name, picked.bytes, key)
  settingsOpen.value = false
}

async function loadRomBytes(name: string, bytes: Uint8Array, key: string) {
  loading.value = true
  try {
    await screen.value?.loadRom(bytes)
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
  bytes?: Uint8Array
}) {
  if (payload.bytes) {
    await loadRomBytes(payload.name, payload.bytes, payload.romKey)
  }
  await screen.value?.applyState(payload.state)
  syncPlayback()
}

function reset() {
  screen.value?.reset()
  paused.value = false
}

function togglePause() {
  paused.value = !paused.value
}

function stopRom() {
  screen.value?.stop()
  romName.value = null
  romKey.value = null
  paused.value = false
}

function toggleAudio() {
  audioOn.value = !audioOn.value
  screen.value?.setAudioEnabled(audioOn.value)
}

function onSystemAction(action: string) {
  if (action === 'open-settings') {
    settingsOpen.value = true
  } else if (action === 'toggle-pause') {
    if (romName.value) togglePause()
  } else if (action === 'open-library') {
    openSettings('library')
  } else if (action === 'open-saves') {
    openSettings('saves')
  } else if (action === 'back') {
    if (props.enableBackExit) consumeBack()
  } else if (action === 'toggle-fullscreen') {
    void toggleFullscreen()
  }
}

const EXIT_CONFIRM_MS = 2000
function handleBack(): BackResult {
  if (layoutEditing.value) {
    finishTouchLayout()
    return 'handled'
  }
  if (helpOpen.value) {
    helpOpen.value = false
    return 'handled'
  }
  if (settingsOpen.value) {
    settingsOpen.value = false
    return 'handled'
  }
  if (romName.value) {
    stopRom()
    return 'handled'
  }
  if (!props.enableBackExit) return 'handled'

  const now = Date.now()
  if (now - exitArmedAt < EXIT_CONFIRM_MS) {
    if (exitHintTimer) {
      clearTimeout(exitHintTimer)
      exitHintTimer = null
    }
    exitHintVisible.value = false
    return 'exit'
  }
  exitArmedAt = now
  exitHintVisible.value = true
  if (exitHintTimer) clearTimeout(exitHintTimer)
  exitHintTimer = setTimeout(() => {
    exitHintVisible.value = false
    exitHintTimer = null
  }, EXIT_CONFIRM_MS)
  return 'handled'
}

function consumeBack() {
  if (handleBack() === 'exit') void props.onExit?.()
}

defineExpose({
  handleBack,
  consumeBack,
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onLayoutKey)
  if (exitHintTimer) clearTimeout(exitHintTimer)
})
</script>

<template>
  <div
    ref="appRef"
    class="app"
    :class="shellClasses"
  >
    <header ref="toolbarRef" class="desktop-toolbar" aria-label="游戏功能区">
      <SButton @click="openSettings('library')">ROM 库</SButton>
      <SButton @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</SButton>
      <SButton title="打开设置 (Esc)" @click="settingsOpen = true">菜单</SButton>
    </header>
    <SettingsModal
      ref="settingsModal"
      v-model:open="settingsOpen"
      v-model:tab="settingsTab"
      :current-rom-key="romKey"
      @load-rom="(p) => loadRomBytes(p.name, p.bytes, p.key)"
      @load-save="onLoadSave"
      @edit-touch-layout="editTouchLayout"
    >
      <template #actions="{ tab }">
        <template v-if="tab === 'library'">
          <SButton :loading="loading" @click="openRom">{{ loading ? openLoadingLabel : '打开本地 ROM' }}</SButton>
        </template>
        <template v-else-if="tab === 'saves'">
          <SButton :loading="creatingSave" :disabled="!romName || loading" @click="newSave">{{ creatingSave ? '保存中…' : '新建存档' }}</SButton>
          <SHint v-if="saveMessage" role="status">{{ saveMessage }}</SHint>
        </template>
        <template v-else-if="tab === 'misc'">
          <SButton :disabled="!romName || loading" @click="reset">复位游戏</SButton>
          <SButton :disabled="!romName || loading" @click="stopRom">中止游戏</SButton>
          <SButton class="desktop-only" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</SButton>
        </template>
        <SButton v-else-if="tab === 'audio'" @click="toggleAudio">{{ audioOn ? '静音' : '开启声音' }}</SButton>
      </template>
    </SettingsModal>
    <ShortcutsPanel v-model:open="helpOpen" :modifier="modKey" />

    <main class="stage">
      <div v-if="layoutEditing" class="layout-edit-tools">
        <span>拖动虚线区域调整位置 · 自动保存</span>
        <SButton @click="resetTouchLayout">重置当前方向</SButton>
        <SButton @click="finishTouchLayout">完成</SButton>
      </div>
      <NesScreen
        ref="screen"
        :input-locked="inputLocked"
        :layout-editing="layoutEditing"
        :game-paused="paused || loading"
        :modifier="modKey"
        :rom-key="romKey"
        :rom-name="romName"
        @system-action="onSystemAction"
      />
      <SEmpty v-if="!romName && !layoutEditing" class="empty-state">
        <p>通过菜单选择游戏或本地 ROM 开始游玩</p>
        <SHint>Esc 打开设置 · F8 快速存档</SHint>
      </SEmpty>
    </main>

    <Transition name="toast">
      <div v-if="exitHintVisible" class="exit-hint" role="status">再按一次返回键退出</div>
    </Transition>

    <PlayerFooter
      :rom-name="romName"
      :platform-label="platformLabel"
      :hide-on-touch="footerHideOnTouch"
      @help="helpOpen = true"
    />
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
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
input,
textarea,
[contenteditable='true'] {
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
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
.desktop-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  overflow-x: auto;
  background: #242424;
  border-bottom: 1px solid #343434;
}
.desktop-toolbar > :deep(.s-button) {
  flex-shrink: 0;
  white-space: nowrap;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  position: relative;
}
.layout-edit-tools {
  position: absolute;
  z-index: 10;
  top: max(8px, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  width: max-content;
  max-width: calc(100% - 24px);
  padding: 8px;
  border-radius: 8px;
  background: #202328ee;
  font-size: 13px;
}
.layout-edit-tools :deep(.s-button) { min-height: 44px; }
.empty-state {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: #ccc;
}
.empty-state p { margin: 0; }
.empty-state small { color: #aaa; }
.exit-hint {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 22px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 14px;
  letter-spacing: 0.3px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 1000;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
@media (pointer: coarse) {
  .desktop-only { display: none; }
  .desktop-toolbar { display: none; }
  .stage {
    padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  }
  .empty-state { top: 8px; gap: 8px; padding: 8px; font-size: 13px; }
  .empty-state small { display: none; }
}
@media (pointer: coarse) and (orientation: landscape) {
  .stage {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
}
</style>
