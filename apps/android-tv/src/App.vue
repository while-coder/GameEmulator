<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { MainView, emulators, type EmulatorId } from '@game-emulator/shell'
const host = window as Window & { __handleAndroidBack?: () => string }
async function launch(id: EmulatorId) {
  const emulator = emulators.find(entry => entry.id === id)!
  location.assign(new URL(emulator.page, location.href).href)
}
onMounted(() => { host.__handleAndroidBack = () => 'exit' })
onBeforeUnmount(() => { delete host.__handleAndroidBack })
</script>
<template><MainView :launch="launch" /></template>
