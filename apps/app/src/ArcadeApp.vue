<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { ArcadeView } from '@game-emulator/arcade'
import { provideDesktopFullscreen } from './useDesktopFullscreen'
provideDesktopFullscreen()
const backOnEscape = __TAURI_DESKTOP__ || __TAURI_ANDROID__
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else location.replace(new URL('index.html', location.href).href)
}
</script>
<template><ArcadeView :on-leave="leave" :back-on-escape="backOnEscape" /></template>
