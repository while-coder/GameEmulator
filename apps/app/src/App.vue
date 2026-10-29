<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { MainView, emulators, type EmulatorId } from '@game-emulator/shell'
import { UpdaterDialog } from '@while-coder/tauri-updater-vue'
import AndroidUpdater from './AndroidUpdater.vue'

const native = '__TAURI_INTERNALS__' in window
const desktop = __TAURI_DESKTOP__
const android = native && __TAURI_ANDROID__
const main = ref<InstanceType<typeof MainView> | null>(null)
const active = ref(true)
const androidUpdater = ref<InstanceType<typeof AndroidUpdater> | null>(null)
const updateModal = ref(false)
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
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = () => androidUpdater.value?.handleBack() ? 'handled' : 'exit'
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
  disposed = true
  unlisten?.()
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <UpdaterDialog v-if="desktop" />
  <MainView ref="main" :launch="launch" :active="active && !updateModal">
    <template v-if="android" #footer>
      <AndroidUpdater ref="androidUpdater" @modal-change="updateModal = $event" />
    </template>
  </MainView>
</template>
