<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { NesView } from '@game-emulator/nes'
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else location.replace(new URL('index.html', location.href).href)
}
</script>
<template><NesView :on-leave="leave" storage-key="nes:app:lastRom" platform-label="NES / FC" /></template>
