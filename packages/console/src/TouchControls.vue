<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTouchLayout } from '../../player-ui/useTouchLayout'
import TouchLayoutEditor from '../../player-ui/TouchLayoutEditor.vue'
import type { TouchControlLayout } from '../../player-ui/touchLayout'
import { PSP_BUTTON_LABELS, type Action } from './systems'

const props = defineProps<{ actions: Action[]; psp?: boolean; editing: boolean; layout: Record<'portrait' | 'landscape', Partial<Record<string, TouchControlLayout>>> }>()
const emit = defineEmits<{ input: [action: Action, down: boolean]; analog: [x: number, y: number] }>()
const settings = computed(() => ({ touchLayout: props.layout }))
const label = (action: Action) => (props.psp && PSP_BUTTON_LABELS[action]) || action.toUpperCase()
const buttons = props.actions.filter(action => !['up', 'down', 'left', 'right'].includes(action))
const controls = [{ id: 'dpad', label: '方向键' }, ...(props.psp ? [{ id: 'analog', label: '模拟摇杆' }] : []), ...buttons.map(action => ({ id: action, label: label(action) }))]
const stick = ref({ x: 0, y: 0 })
let stickPointer: number | undefined
function moveStick(event: PointerEvent) {
  if (event.pointerId !== stickPointer) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = (event.clientX - rect.left - rect.width / 2) / (rect.width * .36)
  const y = (event.clientY - rect.top - rect.height / 2) / (rect.height * .36)
  const range = Math.max(1, Math.hypot(x, y))
  stick.value = { x: x / range, y: y / range }
  emit('analog', stick.value.x, stick.value.y)
}
function startStick(event: PointerEvent) {
  if (props.editing) { startLayoutDrag(event); return }
  if (event.button !== 0 || stickPointer !== undefined) return
  event.preventDefault()
  stickPointer = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  moveStick(event)
}
function releaseStick(event?: PointerEvent) {
  if (stickPointer === undefined || event && event.pointerId !== stickPointer) return
  stickPointer = undefined
  stick.value = { x: 0, y: 0 }
  emit('analog', 0, 0)
}
const active = new Map<number, Action>()
const pressed = ref(new Set<Action>())
function releaseAll() { releaseStick(); for (const action of pressed.value) emit('input', action, false); active.clear(); pressed.value = new Set() }
function down(event: PointerEvent, action: Action) {
  if (props.editing || event.button !== 0) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  active.set(event.pointerId, action); pressed.value = new Set(active.values()); emit('input', action, true)
}
function up(event: PointerEvent) {
  const action = active.get(event.pointerId)
  active.delete(event.pointerId); pressed.value = new Set(active.values())
  if (action && !pressed.value.has(action)) emit('input', action, false)
}
const { controlsRef, selected, selectedLayout, positionStyle, startLayoutDrag, moveLayoutDrag, endLayoutDrag, suppressEditClick, resizeSelected, toggleSelected } = useTouchLayout(
  { get touchLayout() { return settings.value.touchLayout } }, props, controls, releaseAll,
)
watch(() => props.editing, releaseAll)
onBeforeUnmount(releaseAll)
</script>

<template>
  <div ref="controlsRef" class="console-touch" :class="{ editing }" @pointermove="moveLayoutDrag" @pointerup="endLayoutDrag" @pointercancel="endLayoutDrag" @click.capture="suppressEditClick" @contextmenu.prevent>
    <div data-layout-group="dpad" class="console-dpad" :style="positionStyle('dpad')" @pointerdown="startLayoutDrag">
      <button v-for="direction in (['up', 'left', 'down', 'right'] as Action[])" :key="direction" type="button" :class="[direction, { pressed: pressed.has(direction) }]" :aria-label="direction" @pointerdown="down($event, direction)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{ { up: '▲', down: '▼', left: '◀', right: '▶' }[direction as 'up'] }}</button>
    </div>
    <button v-if="psp" class="console-analog" type="button" data-layout-button data-layout-group="analog" aria-label="模拟摇杆" :style="positionStyle('analog')" @pointerdown="startStick" @pointermove="moveStick" @pointerup="releaseStick" @pointercancel="releaseStick" @lostpointercapture="releaseStick"><span :style="{ transform: `translate(${stick.x * 65}%, ${stick.y * 65}%)` }"></span></button>
    <button v-for="action in buttons" :key="action" type="button" data-layout-button :data-layout-group="action" :class="['console-touch-button', action, { pressed: pressed.has(action) }]" :style="positionStyle(action)" @pointerdown="editing ? startLayoutDrag($event) : down($event, action)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{ label(action) }}</button>
    <TouchLayoutEditor v-if="editing" :controls="controls" :selected="selected" :scale="selectedLayout?.scale ?? 1" :hidden="!!selectedLayout?.hidden" @select="selected = $event" @resize="resizeSelected" @toggle="toggleSelected" />
  </div>
</template>
