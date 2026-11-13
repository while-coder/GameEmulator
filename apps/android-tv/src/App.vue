<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { MainView, emulators, type EmulatorId } from '@game-emulator/shell'
import { exitAndroidApp, httpNativeTransport } from '@game-emulator/android-native/transport'
import BackConfirmDialog from '../../../packages/player-ui/BackConfirmDialog.vue'
const host = window as Window & { __handleAndroidBack?: () => string }
const exitConfirm = ref(false)
const exitError = ref('')
function handleBack(): 'handled' {
  exitError.value = ''
  exitConfirm.value = !exitConfirm.value
  return 'handled'
}
async function confirmExit() {
  try { await exitAndroidApp(httpNativeTransport) }
  catch (error) { exitError.value = `退出失败：${error instanceof Error ? error.message : String(error)}` }
}
async function launch(id: EmulatorId) {
  const emulator = emulators.find(entry => entry.id === id)!
  location.assign(new URL(emulator.page, location.href).href)
}
onMounted(() => { host.__handleAndroidBack = handleBack })
onBeforeUnmount(() => { delete host.__handleAndroidBack })
</script>
<template>
  <MainView :launch="launch" :active="!exitConfirm">
    <template #footer><p v-if="exitError" role="alert">{{ exitError }}</p></template>
  </MainView>
  <BackConfirmDialog v-model:show="exitConfirm" action="exit" @confirm="confirmExit" />
</template>
