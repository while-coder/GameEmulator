<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { ArcadeView } from '@game-emulator/arcade'
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else location.replace(new URL('index.html', location.href).href)
}
</script>
<template><ArcadeView :on-leave="leave" /></template>
