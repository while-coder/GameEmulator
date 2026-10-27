<script setup lang="ts">
import { onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ArcadeView } from '@game-emulator/arcade'
const child = new URLSearchParams(location.search).has('child')
async function leave() {
  if (child) await invoke('close_emulator')
  else location.replace(new URL('index.html', location.href).href)
}
onMounted(() => {
  if (child) void invoke('emulator_ready').catch(console.error)
})
</script>
<template><ArcadeView :on-leave="leave" /></template>
