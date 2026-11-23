<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PlayerShell from './components/PlayerShell.vue'
import type { PlayerEntry } from '../../player-ui/playerEntry'

const props = defineProps<{
  onLeave: () => void | Promise<void>
  storageKey?: string
  entry?: PlayerEntry
}>()
const shell = ref<InstanceType<typeof PlayerShell> | null>(null)
// Android's native back callback is installed in each independent document.
function handleBack(): 'handled' {
  shell.value?.handleBack()
  return 'handled'
}
onMounted(() => {
  ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack = handleBack
})
onBeforeUnmount(() => {
  delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
})
</script>

<template>
  <PlayerShell ref="shell" :storage-key="props.storageKey" :on-exit="props.onLeave" :entry="entry" />
</template>
