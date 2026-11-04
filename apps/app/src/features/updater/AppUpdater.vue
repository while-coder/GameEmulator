<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { UpdaterDialog, useTauriUpdater } from '@while-coder/tauri-updater-vue'
import AndroidUpdater from './AndroidUpdater.vue'
import { CurrentReleaseDialog } from '@game-emulator/shell'
import { getVersion } from '@tauri-apps/api/app'

const emit = defineEmits<{ modalChange: [visible: boolean] }>()
const native = isTauri()
const desktop = native && __TAURI_DESKTOP__
const android = native && __TAURI_ANDROID__
const androidUpdater = ref<InstanceType<typeof AndroidUpdater> | null>(null)
const androidModal = ref(false)
const releaseDialog = ref<InstanceType<typeof CurrentReleaseDialog> | null>(null)
const releaseModal = ref(false)
const currentVersion = ref('')
onMounted(async () => {
  if (!native) return
  try {
    currentVersion.value = await getVersion()
  } catch (error) {
    console.warn('[updater] 无法读取应用版本', error)
  }
})
const autoCheckFinished = ref(!desktop && !android)
const updater = desktop ? useTauriUpdater({ isMobileRuntime: () => false, locale: 'zh-CN' }) : null
const updateVisible = computed(() => androidModal.value || Boolean(updater
  && ['available', 'downloading', 'installed', 'error'].includes(updater.updateStatus.value)))
const visible = computed(() => updateVisible.value || releaseModal.value)
onMounted(async () => {
  if (!updater) return
  try {
    await updater.checkForUpdate({ silent: true })
  } finally {
    autoCheckFinished.value = true
  }
})

watch(visible, value => emit('modalChange', value), { immediate: true })
defineExpose({ handleBack: () => androidUpdater.value?.handleBack() || releaseDialog.value?.handleBack() || false })
</script>

<template>
  <UpdaterDialog v-if="desktop" :auto-check="false" locale="zh-CN" />
  <AndroidUpdater v-else-if="android" ref="androidUpdater" @modal-change="androidModal = $event" @auto-check-finished="autoCheckFinished = true" />
  <CurrentReleaseDialog v-if="native" ref="releaseDialog"
    :version="currentVersion"
    :enabled="autoCheckFinished && !updateVisible && updater?.updateStatus.value !== 'checking'"
    @modal-change="releaseModal = $event" />
</template>
