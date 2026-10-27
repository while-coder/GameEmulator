<script setup lang="ts">
import { PlayerShell, isTauri } from '@nes-emulator/ui'
</script>

<template>
  <PlayerShell
    title="NES 模拟器"
    hint="点击「打开 ROM」选择一个 .nes 文件开始游戏"
    :platform-label="isTauri ? 'Tauri 模式' : 'Web 模式'"
    library-label="ROM 库"
    toolbar-mode="web"
    storage-key="nes:lastRom"
    open-loading-label="载入中…"
    footer-hide-on-touch
  />
</template>
