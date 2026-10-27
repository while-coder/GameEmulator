<script setup lang="ts">
import { settings } from '../emulator/settings'
import { navEnabled, hasGamepad } from '../composables/useRemoteNav'
import { useInputMonitor } from '../composables/useInputMonitor'

defineProps<{
  // 当前载入的 ROM 名,未载入时为 null(显示「未载入」)。
  romName: string | null
  // 右侧平台标注文案,由各宿主传入(如 'Tauri App' / '浏览器预览' / 'Web 模式')。
  platformLabel: string
  // 触屏设备隐藏状态栏,让出垂直空间。
  hideOnTouch?: boolean
}>()

// 调试:当前按下的按键(键盘/手柄/遥控),仅在设置开启时显示。
const { label: inputLabel } = useInputMonitor()
</script>

<template>
  <footer class="footer" :class="{ 'hide-on-touch': hideOnTouch }">
    <span v-if="navEnabled && !hasGamepad" class="tv-tip">游戏操作需连接手柄;遥控器用于菜单导航,返回键退出</span>
    <span v-if="settings.misc.showInputDebug" class="input-debug">
      按键 <b>{{ inputLabel || '—' }}</b>
    </span>
    <span class="meta">{{ romName ?? '未载入' }} · {{ platformLabel }}</span>
  </footer>
</template>

<style scoped>
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  background: #242424;
  border-top: 1px solid #343434;
  color: #aaa;
  font-size: 12px;
}
.footer .meta {
  color: #777;
  margin-left: auto;
}
/* 调试:当前按下的按键 */
.footer .input-debug {
  color: #888;
  font-family: ui-monospace, 'Cascadia Code', monospace;
}
.footer .input-debug b {
  color: #6ab0ff;
  font-weight: 600;
}
.footer .tv-tip {
  color: #6ab0ff;
}
/* 触屏设备可隐藏状态栏,让出垂直空间。 */
@media (pointer: coarse) {
  .footer.hide-on-touch {
    display: none;
  }
}
</style>
