<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createHoldAction } from './holdAction'
import { useRemoteNav } from './useRemoteNav'

const props = defineProps<{ name: string; detail: string; disabled: boolean; busy: boolean; canRemove: boolean }>()
const emit = defineEmits<{ play: []; remove: [] }>()
const trigger = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const shown = ref(false)
const position = ref<Record<string, string>>({})
let origin: { x: number; y: number } | null = null
let keyboardPress = false
let suppressClick = false
let disposed = false

function cancelPress() { hold.cancel(); keyboardPress = false; origin = null }
function cancelPointer() { if (origin) suppressClick = true; cancelPress() }
async function openMenu(point?: { x: number; y: number }) {
  if (props.disabled || shown.value) return
  suppressClick = true
  position.value = {}
  shown.value = true
  await nextTick()
  if (disposed || !shown.value) return
  dialog.value?.showModal()
  if (point && dialog.value) {
    const rect = dialog.value.getBoundingClientRect()
    position.value = {
      margin: '0',
      left: `${Math.max(8, Math.min(point.x, innerWidth - rect.width - 8))}px`,
      top: `${Math.max(8, Math.min(point.y, innerHeight - rect.height - 8))}px`,
    }
  }
}
const hold = createHoldAction(() => { void openMenu() })
function closeMenu() { shown.value = false; dialog.value?.close() }
async function closed() {
  shown.value = false
  cancelPress()
  await nextTick()
  if (!disposed && trigger.value?.isConnected && !props.disabled) trigger.value.focus({ preventScroll: true })
}
function choose(action: 'play' | 'remove') {
  closeMenu()
  if (!props.disabled) {
    if (action === 'play') emit('play')
    else if (props.canRemove) emit('remove')
  }
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || event.button !== 0 || !event.isPrimary) return
  suppressClick = false
  origin = { x: event.clientX, y: event.clientY }
  hold.start()
}
function pointerMove(event: PointerEvent) {
  if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
    suppressClick = true
    cancelPress()
  }
}
function click(event: MouseEvent) {
  if (suppressClick || hold.held || shown.value) { event.preventDefault(); return }
  if (!props.disabled) emit('play')
}
function isConfirm(event: KeyboardEvent) {
  return ['Enter', 'NumpadEnter', 'Select', 'Accept', ' '].includes(event.key) || event.keyCode === 23
}
function keyDown(event: KeyboardEvent) {
  if (event.key === 'F10' && event.shiftKey) {
    event.preventDefault(); cancelPress(); return
  }
  if (event.key === 'ContextMenu' || event.key === 'Menu' || event.keyCode === 82) {
    event.preventDefault(); event.stopPropagation(); cancelPress(); void openMenu()
  } else if (isConfirm(event)) {
    event.preventDefault(); event.stopPropagation()
    if (!event.repeat && !keyboardPress && !props.disabled) {
      keyboardPress = true; suppressClick = false; hold.start()
    }
  } else cancelPress()
}
function keyUp(event: KeyboardEvent) {
  if (!isConfirm(event)) return
  event.preventDefault(); event.stopPropagation()
  const short = hold.release()
  keyboardPress = false
  if (short && !props.disabled && !shown.value) emit('play')
}
function padDown() {
  if (props.disabled) return
  keyboardPress = true; suppressClick = false; hold.start()
}
function padUp() {
  const short = hold.release()
  keyboardPress = false
  if (short && !props.disabled && !shown.value) emit('play')
}
watch(() => props.disabled, disabled => { if (disabled) { cancelPress(); closeMenu() } })
onBeforeUnmount(() => { disposed = true; cancelPress(); dialog.value?.close() })
useRemoteNav({ container: dialog, active: computed(() => shown.value), autoFocus: true, priority: 25, onBack: closeMenu })
</script>

<template>
  <button ref="trigger" class="game-launch" data-nav-primary data-nav-hold
    :disabled="disabled" :aria-label="`开始 ${name}；长按或右键打开操作菜单`"
    :title="`${name} · ${detail}\n右键 / 长按 / 菜单键：游戏操作`" :aria-busy="busy"
    aria-haspopup="dialog" :aria-expanded="shown"
    @click="click" @contextmenu.prevent.stop="openMenu($event.pointerType === 'mouse' || $event.button === 2 ? { x: $event.clientX, y: $event.clientY } : undefined)"
    @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="hold.release(); origin = null"
    @pointercancel="cancelPointer" @pointerleave="cancelPointer" @blur="cancelPress"
    @keydown="keyDown" @keyup="keyUp" @nav-confirm-start="padDown" @nav-confirm-end="padUp" @nav-confirm-cancel="cancelPress" />
  <Teleport to="body">
    <dialog ref="dialog" class="game-card-menu" :style="position" aria-label="游戏操作"
      @cancel.prevent="closeMenu" @close="closed" @click="event => { if (event.target === dialog) closeMenu() }">
      <h2>{{ name }}</h2>
      <button type="button" @click="choose('play')">开始游戏</button>
      <button v-if="canRemove" type="button" class="remove-cache" @click="choose('remove')">移除下载缓存</button>
      <button type="button" class="cancel-menu" @click="closeMenu">取消</button>
    </dialog>
  </Teleport>
</template>

<style scoped>
.game-card-menu { width: min(300px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 8px; border: 1px solid #566273; border-radius: 10px; background: #252a32; color: #e8eaed; box-shadow: 0 12px 36px #0008; }
.game-card-menu::backdrop { background: #0005; }
h2 { margin: 0; padding: 8px; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.game-card-menu button { display: block; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.game-card-menu button:hover { background: #35445a; }
.game-card-menu .remove-cache { color: #ffb4b4; }
.game-card-menu .cancel-menu { border-top: 1px solid #414751; border-radius: 0 0 6px 6px; color: #b6bfcc; }
</style>
