<script setup lang="ts">
import { playerEntry, returnToLobby } from '@game-emulator/shell'
import { invoke } from '@tauri-apps/api/core'
import { NesView } from '@game-emulator/nes'
import { provideDesktopFullscreen } from './useDesktopFullscreen'
const entry = playerEntry()
provideDesktopFullscreen()
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else returnToLobby()
}
</script>
<template><NesView :on-leave="leave" :entry="entry" /></template>
