<script setup lang="ts">
import { playerEntry, returnToLobby } from '@game-emulator/shell'
import { invoke } from '@tauri-apps/api/core'
import { ArcadeView } from '@game-emulator/arcade'
import { provideDesktopFullscreen } from './useDesktopFullscreen'
const entry = playerEntry()
provideDesktopFullscreen()
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else returnToLobby()
}
</script>
<template><ArcadeView :on-leave="leave" :entry="entry" /></template>
