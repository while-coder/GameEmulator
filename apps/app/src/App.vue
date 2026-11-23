<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { exit } from '@tauri-apps/plugin-process'
import { createWebViewTransport, exitAndroidApp } from '@game-emulator/android-native/transport'
import { isAndroid } from '@game-emulator/nes'
import { GameLobby, openPlayerPage, type EmulatorId, type PlayerEntry } from '@game-emulator/shell'
import BackConfirmDialog from '../../../packages/player-ui/BackConfirmDialog.vue'
import AppUpdater from './features/updater/AppUpdater.vue'

const native = '__TAURI_INTERNALS__' in window
const nativeSaves = __TAURI_ANDROID__ || (native && isAndroid)
const lobby = ref<InstanceType<typeof GameLobby> | null>(null)
const active = ref(true)
const appUpdater = ref<InstanceType<typeof AppUpdater> | null>(null)
const updateModal = ref(false)
const exitConfirm = ref(false)
const exitError = ref('')
const androidTransport = createWebViewTransport()
function handleBack(): 'handled' {
  if (exitConfirm.value) exitConfirm.value = false
  else if (appUpdater.value?.handleBack() || lobby.value?.handleBack()) return 'handled'
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
  handleBack()
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
async function launch(id: EmulatorId, entry?: PlayerEntry) {
  if (native && __TAURI_DESKTOP__) {
    if (!entry) throw new Error('缺少模拟器启动参数')
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
      // An older native process can ignore a new argument to its old command.
      await Promise.all([invoke('open_emulator_with_entry', { id, entry }), ready])
    } catch (err) {
      await invoke('close_emulator').catch(console.error)
      active.value = true
      if (String(err).includes('Command open_emulator_with_entry not found')) {
        throw new Error('桌面程序仍在运行旧版本，请退出并重新启动调试')
      }
      throw err
    } finally {
      clearTimeout(timer)
      readyOff?.()
    }
  } else {
    openPlayerPage(id, entry)
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = handleBack
  if (native) {
    const off = await listen('emulator-closed', () => {
      active.value = true
      void lobby.value?.resume()
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
  <GameLobby ref="lobby" :launch="launch" :native-saves="nativeSaves" :active="active && !updateModal && !exitConfirm" @unhandled-back="handleBack">
    <template #footer>
      <AppUpdater ref="appUpdater" @modal-change="updateModal = $event" />
      <p v-if="exitError" role="alert">{{ exitError }}</p>
    </template>
  </GameLobby>
  <BackConfirmDialog v-model:show="exitConfirm" action="exit" @confirm="confirmExit" />
</template>
