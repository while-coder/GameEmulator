<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PlayerShell from './components/PlayerShell.vue'

const props = defineProps<{
  onLeave: () => void | Promise<void>
  storageKey?: string
  platformLabel?: string
}>()
const shell = ref<InstanceType<typeof PlayerShell> | null>(null)
// Android's native back callback is installed in each independent document.
function handleBack(): 'handled' {
  shell.value?.consumeBack()
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
  <PlayerShell ref="shell" title="NES / FC 模拟器" :platform-label="platformLabel ?? 'NES / FC'"
    :storage-key="storageKey ?? 'nes:lastRom'" enable-back-exit :on-exit="props.onLeave" />
</template>
