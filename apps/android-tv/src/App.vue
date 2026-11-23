<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { GameLobby, openPlayerPage } from '@game-emulator/shell'
import { exitAndroidApp, httpNativeTransport } from '@game-emulator/android-native/transport'
import BackConfirmDialog from '../../../packages/player-ui/BackConfirmDialog.vue'

const lobby = ref<InstanceType<typeof GameLobby> | null>(null)
const exitConfirm = ref(false)
const exiting = ref(false)
const error = ref('')
const active = computed(() => !exitConfirm.value && !exiting.value)
const host = window as Window & { __handleAndroidBack?: () => string }

function handleBack(): 'handled' {
  if (exitConfirm.value) exitConfirm.value = false
  else if (!exiting.value && !lobby.value?.handleBack()) { error.value = ''; exitConfirm.value = true }
  return 'handled'
}

async function confirmExit() {
  if (exiting.value) return
  exiting.value = true
  try { await exitAndroidApp(httpNativeTransport) }
  catch (reason) { error.value = `退出失败：${reason instanceof Error ? reason.message : reason}` }
  finally { exiting.value = false }
}

onMounted(() => { host.__handleAndroidBack = handleBack })
onBeforeUnmount(() => { delete host.__handleAndroidBack })
</script>

<template>
  <GameLobby ref="lobby" native-saves :active="active" :launch="openPlayerPage" @unhandled-back="handleBack">
    <template #footer><p v-if="error" role="alert">{{ error }}</p></template>
  </GameLobby>
  <BackConfirmDialog v-model:show="exitConfirm" action="exit" @confirm="confirmExit" />
</template>
