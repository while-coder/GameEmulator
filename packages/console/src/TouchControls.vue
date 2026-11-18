<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTouchLayout } from '../../player-ui/useTouchLayout'
import TouchLayoutEditor from '../../player-ui/TouchLayoutEditor.vue'
import type { TouchControlLayout } from '../../player-ui/touchLayout'
import type { Action } from './systems'

const props = defineProps<{ actions: Action[]; editing: boolean; layout: Record<'portrait' | 'landscape', Partial<Record<string, TouchControlLayout>>> }>()
const emit = defineEmits<{ input: [action: Action, down: boolean] }>()
const settings = computed(() => ({ touchLayout: props.layout }))
const controls = [{ id: 'dpad', label: '方向键' }, ...props.actions.filter(action => !['up', 'down', 'left', 'right'].includes(action)).map(action => ({ id: action, label: action.toUpperCase() }))]
const active = new Map<number, Action>()
const pressed = ref(new Set<Action>())
function releaseAll() { for (const action of pressed.value) emit('input', action, false); active.clear(); pressed.value = new Set() }
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
    <button v-for="action in actions.filter(action => !['up', 'down', 'left', 'right'].includes(action))" :key="action" type="button" data-layout-button :data-layout-group="action" :class="['console-touch-button', action, { pressed: pressed.has(action) }]" :style="positionStyle(action)" @pointerdown="editing ? startLayoutDrag($event) : down($event, action)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{ action.toUpperCase() }}</button>
    <TouchLayoutEditor v-if="editing" :controls="controls" :selected="selected" :scale="selectedLayout?.scale ?? 1" :hidden="!!selectedLayout?.hidden" @select="selected = $event" @resize="resizeSelected" @toggle="toggleSelected" />
  </div>
</template>
