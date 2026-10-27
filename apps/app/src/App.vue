<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { exit } from '@tauri-apps/plugin-process'
import { PlayerShell, isTauri } from '@nes-emulator/ui'
import { UpdaterDialog } from '@while-coder/tauri-updater-vue'

const shell = ref<InstanceType<typeof PlayerShell> | null>(null)

async function exitApp() {
  if (isTauri) {
    try {
      await exit(0)
    } catch (err) {
      console.warn('[app] 退出失败', err)
    }
  } else {
    window.close()
  }
}

function handleAndroidBack(): 'exit' | 'handled' {
  return shell.value?.handleBack() ?? 'exit'
}

function onPopState() {
  shell.value?.consumeBack()
  history.pushState(null, '', location.href)
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    ;(window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack =
      handleAndroidBack
  }
  if (isTauri && typeof window !== 'undefined') {
    history.pushState(null, '', location.href)
    window.addEventListener('popstate', onPopState)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', onPopState)
    delete (window as Window & { __handleAndroidBack?: () => string }).__handleAndroidBack
  }
})
</script>

<template>
  <UpdaterDialog />
  <PlayerShell
    ref="shell"
    title="NES/FC 模拟器"
    hint="打开本地 .nes 文件开始游戏"
    :platform-label="isTauri ? 'Tauri App' : '浏览器预览'"
    library-label="游戏库"
    toolbar-mode="app"
    storage-key="nes:app:lastRom"
    enable-back-exit
    :on-exit="exitApp"
  />
</template>
