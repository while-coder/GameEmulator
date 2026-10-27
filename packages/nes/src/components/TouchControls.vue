<script setup lang="ts">
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
/** 固定底座八方向摇杆，保留 NES 数字方向、斜向与多点触控。 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { PadButton, settings, type TouchLayoutGroup } from '../emulator/settings'

const props = defineProps<{ disabled?: boolean; menuDisabled?: boolean; canSave?: boolean; editing?: boolean }>()
const emit = defineEmits<{ press: [PadButton]; release: [PadButton]; menu: []; quickSave: [] }>()

const controlsRef = ref<HTMLElement | null>(null)
const orientation = ref<'portrait' | 'landscape'>('landscape')
const groupSizes = reactive<Record<string, { width: number; height: number }>>({})
const layout = computed(() => settings.touchLayout[orientation.value])
let layoutObserver: ResizeObserver | null = null
let drag: { pointerId: number; group: TouchLayoutGroup; element: HTMLElement; offsetX: number; offsetY: number } | null = null

function measureLayout() {
  orientation.value = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
  for (const el of controlsRef.value?.querySelectorAll<HTMLElement>('[data-layout-group]') ?? []) {
    groupSizes[el.dataset.layoutGroup!] = { width: el.offsetWidth, height: el.offsetHeight }
  }
}
function positionStyle(group: TouchLayoutGroup) {
  const position = layout.value[group]
  const size = groupSizes[group]
  if (!position || !size) return undefined
  return {
    position: 'absolute' as const,
    // 竖屏默认的网格区域与 place-self 会改变绝对定位的坐标基准。
    gridArea: 'auto',
    placeSelf: 'auto',
    margin: '0',
    left: `clamp(${size.width / 2}px, ${position.x * 100}%, calc(100% - ${size.width / 2}px))`,
    top: `clamp(${size.height / 2}px, ${position.y * 100}%, calc(100% - ${size.height / 2}px))`,
    right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)',
  }
}
function startLayoutDrag(event: PointerEvent) {
  if (!props.editing || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  if (drag) return
  const element = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-group]')
  if (!element) return
  releaseAll()
  const rect = element.getBoundingClientRect()
  drag = { pointerId: event.pointerId, group: element.dataset.layoutGroup as TouchLayoutGroup, element,
    offsetX: event.clientX - rect.left - rect.width / 2,
    offsetY: event.clientY - rect.top - rect.height / 2 }
  element.setPointerCapture(event.pointerId)
}
function moveLayoutDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = controlsRef.value!.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const rect = drag.element.getBoundingClientRect()
  const x = Math.max(rect.width / 2, Math.min(bounds.width - rect.width / 2, event.clientX - bounds.left - drag.offsetX))
  const y = Math.max(rect.height / 2, Math.min(bounds.height - rect.height / 2, event.clientY - bounds.top - drag.offsetY))
  layout.value[drag.group] = { x: x / bounds.width, y: y / bounds.height }
}
function endLayoutDrag() {
  if (!drag) return
  const previous = drag
  drag = null
  releaseCapture(previous.element, previous.pointerId)
}
function suppressEditClick(event: MouseEvent) {
  if (!props.editing) return
  event.preventDefault()
  event.stopPropagation()
}
watch(() => props.editing, () => { endLayoutDrag(); releaseAll() })
onMounted(() => {
  measureLayout()
  layoutObserver = new ResizeObserver(measureLayout)
  if (controlsRef.value) {
    layoutObserver.observe(controlsRef.value)
    for (const el of controlsRef.value.querySelectorAll('[data-layout-group]')) layoutObserver.observe(el)
  }
  window.addEventListener('resize', endLayoutDrag)
})
onBeforeUnmount(() => {
  endLayoutDrag()
  layoutObserver?.disconnect()
  window.removeEventListener('resize', endLayoutDrag)
})

// 触点角度(0=右,逆时针)round 到最近 45° -> 该扇区激活的方向集合。
const SECTORS: PadButton[][] = [
  [PadButton.Right], // E
  [PadButton.Right, PadButton.Up], // NE
  [PadButton.Up], // N
  [PadButton.Up, PadButton.Left], // NW
  [PadButton.Left], // W
  [PadButton.Left, PadButton.Down], // SW
  [PadButton.Down], // S
  [PadButton.Down, PadButton.Right], // SE
]

const dpadRef = ref<HTMLElement | null>(null)
const activeDirs = ref<PadButton[]>([])
const stickOffset = ref({ x: 0, y: 0 })
const buttonPointers = new Map<number, { pad: PadButton; element: HTMLElement }>()
let dirPointerId: number | null = null

/** 由屏幕坐标算出方向区当前应激活的方向集(死区内为空)。 */
function dirsAt(clientX: number, clientY: number): PadButton[] {
  const el = dpadRef.value
  if (!el) return []
  const r = el.getBoundingClientRect()
  const dx = clientX - (r.left + r.width / 2)
  const dy = clientY - (r.top + r.height / 2)
  const distance = Math.hypot(dx, dy)
  const travel = r.width * 0.28
  const scale = distance > travel ? travel / distance : 1
  stickOffset.value = { x: dx * scale, y: dy * scale }
  if (distance < r.width * 0.14) return [] // 回到中心死区时立即松开方向
  let angle = (Math.atan2(-dy, dx) * 180) / Math.PI // 上为正
  if (angle < 0) angle += 360
  return SECTORS[Math.round(angle / 45) % 8]
}

/** 把方向集切到 next:对消失的方向 release、新增的 press。 */
function setDirs(next: PadButton[]) {
  const prev = activeDirs.value
  for (const p of prev) if (!next.includes(p)) emit('release', p)
  for (const n of next) if (!prev.includes(n)) emit('press', n)
  activeDirs.value = next
}

function releaseCapture(element: HTMLElement | null, pointerId: number) {
  if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
}

function finishDirection() {
  const pointerId = dirPointerId
  dirPointerId = null
  setDirs([])
  stickOffset.value = { x: 0, y: 0 }
  if (pointerId !== null) releaseCapture(dpadRef.value, pointerId)
}

/** 按键热区外扩:补偿圆形按键命中的圆角缺口与手指落点偏差。 */
const BUTTON_HOTZONE = 6

/** 按下点是否落在任一实体按键(A/B/连发/Select/Start/菜单)的热区内。 */
function overButton(clientX: number, clientY: number): boolean {
  for (const el of controlsRef.value?.querySelectorAll<HTMLElement>('.akey, .fkey') ?? []) {
    const r = el.getBoundingClientRect()
    if (clientX >= r.left - BUTTON_HOTZONE && clientX <= r.right + BUTTON_HOTZONE
      && clientY >= r.top - BUTTON_HOTZONE && clientY <= r.bottom + BUTTON_HOTZONE) return true
  }
  return false
}

function onDpadDown(e: PointerEvent) {
  if (props.disabled || settings.misc.touchPad === 'never' || dirPointerId !== null || e.button !== 0) return
  // 布局重叠时按键优先:落点在按键热区内(含穿透到摇杆的)不驱动方向。
  if (overButton(e.clientX, e.clientY)) return
  e.preventDefault()
  // 先捕获再记录状态；捕获失败时不留下按住标记。
  dpadRef.value?.setPointerCapture(e.pointerId)
  dirPointerId = e.pointerId
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadMove(e: PointerEvent) {
  if (e.pointerId !== dirPointerId) return
  if (props.disabled || e.buttons === 0) {
    finishDirection()
    return
  }
  e.preventDefault()
  setDirs(dirsAt(e.clientX, e.clientY))
}
function onDpadUp(e: PointerEvent) {
  if (e.pointerId === dirPointerId) finishDirection()
}

function onBtnDown(e: PointerEvent, pad: PadButton) {
  if (props.disabled || settings.misc.touchPad === 'never' || e.button !== 0 || buttonPointers.has(e.pointerId)) return
  const element = e.currentTarget as HTMLElement
  e.preventDefault()
  element.setPointerCapture(e.pointerId)
  const alreadyPressed = Array.from(buttonPointers.values()).some(value => value.pad === pad)
  buttonPointers.set(e.pointerId, { pad, element })
  if (!alreadyPressed) emit('press', pad)
}
function onBtnUp(e: PointerEvent) {
  const pointer = buttonPointers.get(e.pointerId)
  if (!pointer) return
  buttonPointers.delete(e.pointerId)
  if (!Array.from(buttonPointers.values()).some(value => value.pad === pointer.pad)) emit('release', pointer.pad)
  releaseCapture(pointer.element, e.pointerId)
}
function onPointerEnd(e: PointerEvent) {
  if (drag?.pointerId === e.pointerId) endLayoutDrag()
  onDpadUp(e)
  onBtnUp(e)
}
function releaseAll() {
  endLayoutDrag()
  finishDirection()
  const pointers = Array.from(buttonPointers.entries())
  buttonPointers.clear()
  for (const pad of new Set(pointers.map(([, value]) => value.pad))) emit('release', pad)
  for (const [pointerId, { element }] of pointers) releaseCapture(element, pointerId)
}
function onVisibilityChange() {
  if (document.hidden) releaseAll()
}
watch(() => [props.disabled, settings.misc.touchPad], releaseAll, { flush: 'sync' })
onMounted(() => {
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)
  window.addEventListener('blur', releaseAll)
  window.addEventListener('resize', releaseAll)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  releaseAll()
  window.removeEventListener('pointerup', onPointerEnd, true)
  window.removeEventListener('pointercancel', onPointerEnd, true)
  window.removeEventListener('blur', releaseAll)
  window.removeEventListener('resize', releaseAll)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div ref="controlsRef" class="touch-controls" :class="editing ? 'always editing' : settings.misc.touchPad"
    @pointerdown.capture="startLayoutDrag" @pointermove.capture="moveLayoutDrag"
    @lostpointercapture="endLayoutDrag" @click.capture="suppressEditClick">
    <!-- 左：固定底座与可回中的摇杆 -->
    <div
      ref="dpadRef"
      class="dpad"
      data-layout-group="dpad"
      :style="positionStyle('dpad')"
      :class="{ active: activeDirs.length > 0 }"
      :aria-disabled="disabled"
      role="group"
      aria-label="八方向摇杆"
      @pointerdown="onDpadDown"
      @pointermove="onDpadMove"
      @pointerup="onDpadUp"
      @pointercancel="onDpadUp"
      @lostpointercapture="onDpadUp"
      @contextmenu.prevent
    >
      <span class="stick-guide" aria-hidden="true" />
      <span class="stick-knob" aria-hidden="true" :style="{ transform: `translate(${stickOffset.x}px, ${stickOffset.y}px)` }" />
    </div>

    <!-- 横屏分列于摇杆和 A/B 上方，竖屏保持一行。 -->
    <div class="fn">
      <div class="fn-group fn-left" aria-label="菜单和快存" data-layout-group="functionsLeft" :style="positionStyle('functionsLeft')">
      <SButton class="fkey system-key" :disabled="!editing && menuDisabled" aria-label="打开设置菜单" @click="emit('menu')">菜单</SButton>
      <SButton class="fkey system-key" :disabled="!editing && !canSave" aria-label="快速存档" @click="emit('quickSave')">快存</SButton>

      </div>
      <div class="fn-group fn-right" aria-label="SELECT 和 START" data-layout-group="functionsRight" :style="positionStyle('functionsRight')">
      <button
        :disabled="!editing && disabled"
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Select)"
        @pointerup="onBtnUp"
        @pointercancel="onBtnUp"
        @lostpointercapture="onBtnUp"
        @contextmenu.prevent
      >
        SELECT
      </button>
      <button
        :disabled="!editing && disabled"
        class="fkey"
        @pointerdown="onBtnDown($event, PadButton.Start)"
        @pointerup="onBtnUp"
        @pointercancel="onBtnUp"
        @lostpointercapture="onBtnUp"
        @contextmenu.prevent
      >
        START
      </button>

      </div>
    </div>

    <!-- 右：A/B 平排，每列上方为对应的连发键 -->
    <div class="actions" data-layout-group="actions" :style="positionStyle('actions')">
      <div class="col col-b">
        <button
          :disabled="!editing && disabled"
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboB)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          连B
        </button>
        <button
          :disabled="!editing && disabled"
          class="akey ab b"
          @pointerdown="onBtnDown($event, PadButton.B)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          B
        </button>
      </div>
      <div class="col col-a">
        <button
          :disabled="!editing && disabled"
          class="akey turbo"
          @pointerdown="onBtnDown($event, PadButton.TurboA)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          连A
        </button>
        <button
          :disabled="!editing && disabled"
          class="akey ab a"
          @pointerdown="onBtnDown($event, PadButton.A)"
          @pointerup="onBtnUp"
          @pointercancel="onBtnUp"
          @lostpointercapture="onBtnUp"
          @contextmenu.prevent
        >
          A
        </button>
      </div>
    </div>
  </div>
  <SButton
    v-if="!editing && settings.misc.touchPad === 'never'"
    class="fkey system-key menu-entry"
    :disabled="!editing && menuDisabled"
    aria-label="打开设置菜单"
    @click="emit('menu')"
  >
    菜单
  </SButton>
</template>

<style scoped>
.touch-controls {
  display: none;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.menu-entry {
  display: none;
}
/* 默认按主要输入设备显示；always 在桌面也显示完整手柄。 */
.touch-controls {
  position: absolute;
  inset: 0;
  z-index: 5;
  --pad-size: clamp(132px, 20vw, 168px);
  --action-size: clamp(52px, 8vw, 68px);
}
.touch-controls.always { display: block; }
.dpad {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
}
.actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}
.fn {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
}
.fn-group { display: flex; gap: 8px; width: clamp(112px, calc(50vw - 32px), 176px); }
.fn-group .fkey { flex: 1; min-width: 0; width: 0; }
.touch-controls.editing { pointer-events: auto; }
.editing [data-layout-group] { outline: 2px dashed #80b8ff; outline-offset: 4px; cursor: grab; touch-action: none; pointer-events: auto; }
.editing [data-layout-group]:active { cursor: grabbing; }
.editing .fn-group button { pointer-events: none; }
@media (orientation: landscape) {
  .dpad,
  .actions {
    top: auto;
    bottom: 56px;
    transform: none;
  }
  .fn { position: static; inset: auto; transform: none; }
  .fn-group {
    position: absolute;
    display: flex;
    gap: 8px;
  }
  .fn-left {
    left: 8px;
    bottom: calc(56px + var(--pad-size) + 32px);
    width: var(--pad-size);
  }
  .fn-right {
    right: 8px;
    bottom: calc(56px + var(--action-size) * 2 + clamp(8px, 2.2vw, 12px) + 32px);
    width: calc(var(--action-size) * 2 + clamp(8px, 2.5vw, 16px));
  }
  .fn-group .fkey { flex: 1; min-width: 0; width: 0; }
}
@media (pointer: coarse) {
  .menu-entry {
    display: block;
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 5;
  }
  .touch-controls:not(.never) { display: block; }
}
@media (orientation: portrait) {
  .touch-controls.always { display: grid; }
  .touch-controls {
    position: relative;
    inset: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    /* 拖动后按键脱离文档流，仍保留原来的第二行高度。 */
    grid-template-rows: 44px max(var(--pad-size), calc(var(--action-size) * 2 + clamp(8px, 2.2vw, 12px)));
    align-content: center;
    gap: 16px clamp(16px, 5vw, 24px);
    width: 100%;
    padding: 12px clamp(16px, 5vw, 24px);
    height: 100%;
    min-height: 0;
    --pad-size: clamp(132px, 40vw, 180px);
    --action-size: clamp(56px, 17vw, 76px);
  }
  .dpad {
    position: relative;
    grid-column: 1;
    grid-row: 2;
    place-self: center start;
    left: auto;
    top: auto;
    bottom: auto;
    transform: none;
  }
  .actions {
    position: relative;
    grid-column: 2;
    grid-row: 2;
    place-self: center end;
    right: auto;
    top: auto;
    bottom: auto;
    transform: none;
  }
  .fn {
    position: static;
    grid-column: 1 / -1;
    grid-row: 1;
    transform: none;
    justify-content: space-around;
  }
  .fn-left { margin-right: auto; }
  .fn-right { margin-left: auto; }
}
@media (pointer: coarse) and (orientation: portrait) {
  .touch-controls:not(.never) { display: grid; }
}

/* 摇杆：底座不动，帽沿手指移动，松手立即回中。 */
.dpad {
  width: var(--pad-size);
  height: var(--pad-size);
  border-radius: 50%;
  border: 2px solid #555;
  background: radial-gradient(circle, #343434 0 48%, #252525 49% 100%);
  box-shadow: inset 0 2px 10px #0008;
  pointer-events: auto;
  touch-action: none;
}
.stick-guide {
  position: absolute;
  inset: 12%;
  border: 1px dashed #737373;
  border-radius: 50%;
  pointer-events: none;
}
.stick-knob {
  position: absolute;
  width: 44%;
  height: 44%;
  left: 28%;
  top: 28%;
  border: 1px solid #999;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #858585, #454545);
  box-shadow: 0 4px 10px #0009;
  pointer-events: none;
}
.dpad.active .stick-knob {
  border-color: #aad0ff;
  background: radial-gradient(circle at 35% 30%, #8aa6c9, #455b78);
}

/* ===== SELECT / START ===== */
.fn {
  display: flex;
  gap: clamp(10px, 3vw, 16px);
  pointer-events: none;
}
.fkey {
  pointer-events: auto;
  touch-action: none;
  border: none;
  width: clamp(52px, 16vw, 80px);
  flex-shrink: 0;
  height: 44px;
  border-radius: 15px;
  background: rgba(58, 58, 58, 0.85);
  color: #eee;
  font-size: 12px;
}
.fkey:disabled { opacity: 0.45; }
.system-key { background: rgba(47, 107, 216, 0.85); touch-action: manipulation; }
.fkey:focus-visible { outline: 2px solid #4ea1ff; outline-offset: 2px; }
.fkey:active {
  background: rgba(90, 90, 90, 0.95);
}

/* ===== A / B：等尺寸两行两列 ===== */
.actions {
  display: flex;
  align-items: flex-end;
  gap: clamp(8px, 2.5vw, 16px);
  flex: 0 0 auto;
  pointer-events: none;
}
.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 2.2vw, 12px);
  pointer-events: none;
}
.akey {
  width: var(--action-size);
  height: var(--action-size);
  border-radius: 50%;
  pointer-events: auto;
  touch-action: none;
  border: none;
  color: #fff;
}
.akey:active {
  filter: brightness(1.3);
}
.ab {
  background: #c0392b;
  font-size: clamp(18px, 5vw, 22px);
  font-weight: 700;
}
.turbo {
  background: #d98324;
  font-size: clamp(11px, 3vw, 13px);
}
</style>
