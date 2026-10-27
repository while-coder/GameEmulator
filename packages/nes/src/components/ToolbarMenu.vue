<script setup lang="ts">
/**
 * 工具栏下拉菜单:一个触发按钮 + 折叠的菜单项(由 slot 提供)。
 * 点击外部或按 Esc 自动收起;点击任一菜单项后也收起(slot 内容冒泡到容器触发 close)。
 * 菜单项请用 class="menu-item"(可含 <kbd> 显示快捷键),样式由本组件经 :slotted 提供。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'

defineProps<{ label: string }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLElement | null>(null)
// 下拉(Teleport 到 body)的遥控器焦点导航:打开时自动聚焦首项,方向键切项,OK 选中(冒泡触发 close)。
const dropdownRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: dropdownRef,
  active: computed(() => navEnabled.value && open.value),
  onBack: close,
  autoFocus: true,
  priority: 20,
})
// 下拉用 Teleport 挂到 body,避免被工具栏的 overflow:auto 裁剪;打开时按触发按钮定位。
const pos = ref({ top: 0, left: 0 })

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  const r = btn.value?.getBoundingClientRect()
  if (!r) return
  // 默认与按钮左对齐向右展开;但菜单按钮常在工具栏最右端,向右展开会溢出屏幕。
  // 测出下拉实际宽度后把 left 钳到视口内(右溢出即贴右边缘,等效右对齐),两侧留 8px 边距。
  const margin = 8
  const vw = window.innerWidth
  const ddW = dropdownRef.value?.offsetWidth ?? 168
  let left = r.left
  if (left + ddW + margin > vw) left = vw - ddW - margin
  if (left < margin) left = margin
  pos.value = { top: r.bottom + 4, left }
}
function close() {
  open.value = false
}
function onDocClick(e: MouseEvent) {
  // 触发按钮在 root 内;下拉已 Teleport 到 body,点其内部会执行项动作后自然 close。
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="menu">
    <button ref="btn" class="btn" :class="{ active: open }" @click="toggle">
      {{ label }} <span class="caret">▾</span>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="dropdownRef"
        class="dropdown"
        :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
        @click="close"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.menu {
  position: relative;
  flex-shrink: 0;
}
.btn {
  border: none;
  background: #3b3b3b;
  color: #eee;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}
.btn:hover,
.btn.active {
  background: #4b4b4b;
}
.caret {
  font-size: 10px;
  opacity: 0.7;
  margin-left: 2px;
}
.dropdown {
  position: fixed;
  z-index: 100;
  min-width: 168px;
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
:slotted(.menu-item) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: none;
  background: transparent;
  color: #eee;
  padding: 8px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  white-space: nowrap;
}
:slotted(.menu-item:hover:not(:disabled)) {
  background: #3b3b3b;
}
:slotted(.menu-item:disabled) {
  opacity: 0.4;
  cursor: default;
}
:slotted(.menu-item kbd) {
  background: #1f1f1f;
  border: 1px solid #4a4a4a;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px;
  color: #bbb;
}
</style>
