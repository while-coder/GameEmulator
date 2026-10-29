<script setup lang="ts" generic="T">
import { computed, nextTick, ref, useAttrs } from 'vue'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'

// 遥控/手柄友好的下拉框:
// - 鼠标模式(navEnabled 为假):默认使用原生 <select>，searchable 开启时使用可搜索弹层。
// - 遥控模式:渲染触发按钮 —— 选中后按「确定」弹出选项列表,上下键在列表内移动,
//   再按「确定」才切换选项(而非原生 select 那样左右键即时改值,不符合遥控操作习惯)。
// 弹层挂 priority=20 的 useRemoteNav(高于模态的 10),打开时独占按键;BACK/确定后回落。

interface Option {
  value: T
  label: string
}

const props = defineProps<{ options: Option[]; searchable?: boolean }>()
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const model = defineModel<T>()

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const popupRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const filteredOptions = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return text ? props.options.filter(option => option.label.toLocaleLowerCase().includes(text)) : props.options
})
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
  if (props.searchable) {
    const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16)
    style.width = `${width}px`
    style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`
  }
  if (belowSpace >= 220 || belowSpace >= r.top) {
    style.top = `${r.bottom + 4}px`
  } else {
    style.bottom = `${window.innerHeight - r.top + 4}px`
  }
  popupStyle.value = style
  query.value = ''
  open.value = true
  // 弹层渲染后把焦点落到当前选中项(便于上下微调),供遥控/键盘导航起点。
  nextTick(() => {
    if (props.searchable && !navEnabled.value) {
      searchRef.value?.focus()
      return
    }
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

function onPopupKey(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closePopup()
    return
  }
  const options = Array.from(popupRef.value?.querySelectorAll<HTMLButtonElement>('.rs-option') ?? [])
  if (event.key === 'Enter' && event.target === searchRef.value) {
    event.preventDefault()
    options[0]?.click()
    return
  }
  if (navEnabled.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % options.length : (index <= 0 ? options.length - 1 : index - 1)
    options[next]?.focus()
  }
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
  <select v-if="!navEnabled && !searchable" v-bind="attrs" v-model="model" class="remote-select">
    <option v-for="opt in options" :key="String(opt.value)" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>

  <!-- 遥控模式:触发按钮 + 弹出列表 -->
  <button
    v-else
    v-bind="attrs"
    ref="triggerRef"
    type="button"
    class="remote-select rs-trigger"
    aria-haspopup="listbox"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="rs-value">{{ currentLabel }}</span>
    <span class="rs-arrow" aria-hidden="true">▾</span>
  </button>

  <Teleport v-if="open" to="body">
    <div class="rs-backdrop" @click="closePopup" />
    <div ref="popupRef" class="rs-popup" :style="popupStyle" @keydown="onPopupKey">
      <input v-if="searchable" ref="searchRef" v-model="query" class="rs-search" type="search" placeholder="搜索游戏" aria-label="搜索游戏选项" />
      <div class="rs-options" role="listbox">
      <button
        v-for="opt in filteredOptions"
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
      <p v-if="!filteredOptions.length" class="rs-empty" role="status">没有匹配的游戏</p>
      </div>
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
  min-width: 0;
  max-width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  text-align: left;
}
.rs-value {
  min-width: 0;
  flex: 1;
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
  overflow: hidden;
}
.rs-options { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; }
.rs-search { flex-shrink: 0; min-width: 0; min-height: 40px; margin-bottom: 4px; padding: 8px 10px; border: 1px solid #434a54; border-radius: 5px; background: #171a1f; color: #eee; font: inherit; }
.rs-empty { margin: 0; padding: 12px; color: #aaa; font-size: 13px; }
.rs-option {
  border: none;
  background: transparent;
  color: #ddd;
  padding: 8px 12px;
  border-radius: 5px;
  font-size: 14px;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
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
