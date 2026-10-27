<script setup lang="ts">
import { MainView, emulators, type EmulatorId } from '@game-emulator/shell'
async function launch(id: EmulatorId) {
  const emulator = emulators.find((entry) => entry.id === id)!
  location.assign(new URL(emulator.page, location.href).href)
}
</script>
<template><MainView :launch="launch" /></template>
