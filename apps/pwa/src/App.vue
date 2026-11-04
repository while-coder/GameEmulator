<script setup lang="ts">
import { ref } from 'vue'
import { CurrentReleaseDialog, MainView, emulators, type EmulatorId } from '@game-emulator/shell'
import { version } from '../../../package.json'

const releaseModal = ref(false)
async function launch(id: EmulatorId) {
  const emulator = emulators.find((entry) => entry.id === id)!
  location.assign(new URL(emulator.page, location.href).href)
}
</script>
<template>
  <MainView :launch="launch" :active="!releaseModal" />
  <CurrentReleaseDialog :version="version" :enabled="true" @modal-change="releaseModal = $event" />
</template>
