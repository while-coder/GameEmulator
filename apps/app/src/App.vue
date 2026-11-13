<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { exit } from '@tauri-apps/plugin-process'
import { createWebViewTransport, exitAndroidApp } from '@game-emulator/android-native/transport'
import { MainView, emulators, type EmulatorId } from '@game-emulator/shell'
import BackConfirmDialog from '../../../packages/player-ui/BackConfirmDialog.vue'
import AppUpdater from './features/updater/AppUpdater.vue'

const native = '__TAURI_INTERNALS__' in window
const main = ref<InstanceType<typeof MainView> | null>(null)
const active = ref(true)
const appUpdater = ref<InstanceType<typeof AppUpdater> | null>(null)
const updateModal = ref(false)
const exitConfirm = ref(false)
const exitError = ref('')
const androidTransport = createWebViewTransport()
function handleBack(): 'handled' {
  if (exitConfirm.value) exitConfirm.value = false
  else if (appUpdater.value?.handleBack()) return 'handled'
  else if (active.value && !updateModal.value) {
    exitError.value = ''
    exitConfirm.value = true
  }
  return 'handled'
}
function onKey(event: KeyboardEvent) {
  if (!native || !__TAURI_DESKTOP__ || !active.value || updateModal.value || exitConfirm.value || event.defaultPrevented) return
  if (event.key !== 'Escape' || event.repeat) return
  event.preventDefault()
  exitError.value = ''
  exitConfirm.value = true
}
async function confirmExit() {
  try {
    if (__TAURI_ANDROID__) await exitAndroidApp(androidTransport)
    else if (__TAURI_DESKTOP__) await exit(0)
  }
  catch (error) { exitError.value = `退出失败：${error instanceof Error ? error.message : String(error)}` }
}
let unlisten: UnlistenFn | undefined
let disposed = false
async function launch(id: EmulatorId) {
  const emulator = emulators.find((entry) => entry.id === id)!
  if (native && __TAURI_DESKTOP__) {
    active.value = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let readyOff: UnlistenFn | undefined
    try {
      let signalReady!: () => void
      const ready = new Promise<void>((resolve, reject) => {
        signalReady = resolve
        timer = setTimeout(() => reject(new Error('模拟器页面加载超时，请重试')), 20000)
      })
      // Attach before creating the child: a cached page may become ready immediately.
      readyOff = await listen('emulator-ready', signalReady)
      await Promise.all([invoke('open_emulator', { id }), ready])
    } catch (err) {
      await invoke('close_emulator').catch(console.error)
      active.value = true
      throw err
    } finally {
      clearTimeout(timer)
      readyOff?.()
    }
  } else {
    location.assign(new URL(emulator.page, location.href).href)
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = handleBack
  if (native) {
    const off = await listen('emulator-closed', () => {
      active.value = true
      void nextTick(() => main.value?.focusCard())
    })
    if (disposed) off()
    else unlisten = off
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  disposed = true
  unlisten?.()
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <MainView ref="main" :launch="launch" :active="active && !updateModal && !exitConfirm">
    <template #footer>
      <AppUpdater ref="appUpdater" @modal-change="updateModal = $event" />
      <p v-if="exitError" role="alert">{{ exitError }}</p>
    </template>
  </MainView>
  <BackConfirmDialog v-model:show="exitConfirm" action="exit" @confirm="confirmExit" />
</template>
