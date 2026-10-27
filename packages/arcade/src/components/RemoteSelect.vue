<script setup lang="ts" generic="T">
import { computed, nextTick, ref } from 'vue'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'

// 遥控/手柄友好的下拉框:
// - 鼠标模式(navEnabled 为假):直接渲染原生 <select>,行为与体验完全不变。
// - 遥控模式:渲染触发按钮 —— 选中后按「确定」弹出选项列表,上下键在列表内移动,
//   再按「确定」才切换选项(而非原生 select 那样左右键即时改值,不符合遥控操作习惯)。
// 弹层挂 priority=20 的 useRemoteNav(高于模态的 10),打开时独占按键;BACK/确定后回落。

interface Option {
  value: T
  label: string
}

const props = defineProps<{ options: Option[] }>()
const model = defineModel<T>()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const popupRef = ref<HTMLElement | null>(null)
// 弹层固定定位坐标(打开时按触发按钮的矩形计算,避免被面板 overflow 裁剪)。
const popupStyle = ref<Record<string, string>>({})

const currentLabel = computed(() => {
  const hit = props.options.find((o) => o.value === model.value)
  return hit ? hit.label : (props.options[0]?.label ?? '')
})

function openPopup(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const r = trigger.getBoundingClientRect()
  // 优先向下展开;下方空间不足则向上。宽度不小于触发按钮。
  const belowSpace = window.innerHeight - r.bottom
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${r.left}px`,
    minWidth: `${r.width}px`,
    maxHeight: `${Math.max(belowSpace, r.top) - 16}px`,
  }
  if (belowSpace >= 220 || belowSpace >= r.top) {
    style.top = `${r.bottom + 4}px`
  } else {
    style.bottom = `${window.innerHeight - r.top + 4}px`
  }
  popupStyle.value = style
  open.value = true
  // 弹层渲染后把焦点落到当前选中项(便于上下微调),供遥控/键盘导航起点。
  nextTick(() => {
    const el =
      popupRef.value?.querySelector<HTMLElement>('.rs-option[data-selected="true"]') ??
      popupRef.value?.querySelector<HTMLElement>('.rs-option')
    el?.focus()
  })
}

function closePopup(): void {
  if (!open.value) return
  open.value = false
  // 关闭后焦点回到触发按钮,导航链路不断。
  nextTick(() => triggerRef.value?.focus())
}

function toggle(): void {
  if (open.value) closePopup()
  else openPopup()
}

function pick(opt: Option): void {
  model.value = opt.value
  closePopup()
}

// 弹层内的焦点导航:上下选、确定切换(见各选项 @click)、BACK 关闭。
useRemoteNav({
  container: popupRef,
  active: computed(() => navEnabled.value && open.value),
  onBack: closePopup,
  priority: 20,
})
</script>

<template>
  <!-- 鼠标模式:原生下拉,体验不变 -->
  <select v-if="!navEnabled" v-model="model" class="remote-select">
    <option v-for="opt in options" :key="String(opt.value)" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>

  <!-- 遥控模式:触发按钮 + 弹出列表 -->
  <button
    v-else
    ref="triggerRef"
    type="button"
    class="remote-select rs-trigger"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="rs-value">{{ currentLabel }}</span>
    <span class="rs-arrow" aria-hidden="true">▾</span>
  </button>

  <Teleport v-if="open" to="body">
    <div class="rs-backdrop" @click="closePopup" />
    <div ref="popupRef" class="rs-popup" role="listbox" :style="popupStyle">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        class="rs-option"
        role="option"
        :data-selected="opt.value === model"
        :aria-selected="opt.value === model"
        @click="pick(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.remote-select {
  height: 34px;
  border: 1px solid #434a54;
  border-radius: 6px;
  background: #171a1f;
  color: #eee;
  padding: 0 10px;
  font-size: 14px;
}
.rs-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  text-align: left;
}
.rs-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-arrow {
  color: #9aa2ad;
  font-size: 12px;
  flex: none;
}
.rs-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--sui-z-dropdown);
  background: transparent;
}
.rs-popup {
  position: fixed;
  z-index: calc(var(--sui-z-dropdown) + 1);
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
  background: #23272e;
  border: 1px solid #434a54;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}
.rs-option {
  border: none;
  background: transparent;
  color: #ddd;
  padding: 8px 12px;
  border-radius: 5px;
  font-size: 14px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.rs-option:hover,
.rs-option:focus {
  background: #2f6f9f;
  color: #fff;
  outline: none;
}
.rs-option[data-selected='true'] {
  color: #6db3e6;
}
.rs-option[data-selected='true']::before {
  content: '✓ ';
}
</style>
