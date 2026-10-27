<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, NesRunner, type SaveState } from '../emulator/runner'
import TouchControls from './TouchControls.vue'
import {
  createSaveState,
  getSaveState,
  listSaveStates,
  putSaveState,
  QUICK_SLOT,
} from '../store/saveState'
import {
  buildCodeToButton,
  buildPadToButton,
  GAMEPAD_AXIS_THRESHOLD,
  isPadSignalActive,
  isTurbo,
  PadButton,
  padmapFor,
  runnerButton,
  settings,
  syncGamepadAssignments,
  TURBO_TARGET,
  type Aspect,
} from '../emulator/settings'


// inputLocked:模态(游戏库/设置)打开时为真,此时不把输入喂给游戏。
// romKey/romName:当前载入卡带的稳定标识与显示名,用于把存档绑定到对应游戏。
const props = defineProps<{
  inputLocked?: boolean
  gamePaused?: boolean
  layoutEditing?: boolean
  /** 应用级快捷键修饰键:桌面(Tauri)传 'ctrl',浏览器传 'shift'(默认)。 */
  modifier?: 'ctrl' | 'shift'
  romKey?: string | null
  romName?: string | null
}>()
// systemAction:应用级快捷键(手柄空闲键 / 键盘),交父组件处理。
const emit = defineEmits<{ systemAction: [action: string] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const displayRef = ref<HTMLDivElement | null>(null)
const frameRef = ref<HTMLDivElement | null>(null)
let runner: NesRunner | null = null

// 快速存档/读档:单槽,按 romKey 绑定。toast 显示一行短暂的操作反馈。
const toast = ref('')
let toastTimer = 0
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
    toastTimer = 0
  }, 1600)
}

// 把存/读档异常压成一行可读文案,优先用 DOMException 的 name(如 QuotaExceededError、
// DataCloneError、InvalidStateError),便于在 toast 上直接看出失败类别。
function describeError(err: unknown): string {
  if (err instanceof DOMException) return err.name
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

async function quickSave() {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return
  }
  const state = await runner.saveState()
  if (!state) {
    showToast('存档失败')
    return
  }
  try {
    await putSaveState(props.romKey, QUICK_SLOT, props.romName ?? props.romKey, state)
    showToast('已存档')
  } catch (err) {
    console.error('[NES] 快速存档失败', err)
    showToast(`存档失败: ${describeError(err)}`)
  }
}

// 快速新建存档:不覆盖 quick,而是往存档列表追加一条(自动编号 label)。
async function quickNewSave(): Promise<boolean> {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return false
  }
  try {
    const state = await runner.saveState()
    if (!state) {
      showToast('存档失败')
      return false
    }
    const list = await listSaveStates(props.romKey)
    const count = list.filter((r) => r.slot !== QUICK_SLOT).length
    await createSaveState(props.romKey, props.romName ?? props.romKey, `存档 ${count + 1}`, state)
    showToast('已新建存档')
    return true
  } catch (err) {
    console.error('[NES] 新建存档失败', err)
    showToast(`存档失败: ${describeError(err)}`)
    return false
  }
}

async function quickLoad() {
  if (!runner?.loaded || !props.romKey) {
    showToast('请先载入游戏')
    return
  }
  let record
  try {
    record = await getSaveState(props.romKey, QUICK_SLOT)
  } catch (err) {
    console.error('[NES] 读档失败', err)
    showToast(`读档失败: ${describeError(err)}`)
    return
  }
  if (!record) {
    showToast('暂无存档')
    return
  }
  showToast((await runner.loadState(record.state)) ? '已读档' : '读档失败')
}

const NATIVE_W = 256
const NATIVE_H = 240

// 键盘映射独立生效;同一个键可同时控制两位玩家。
const codeToAction = computed(() => {
  const out: Record<string, { player: number; pad: number }[]> = {}
  settings.players.forEach((p, pi) => {
    const map = buildCodeToButton(p.keymap)
    for (const code in map) (out[code] ??= []).push({ player: pi, pad: map[code] })
  })
  return out
})

// 焦点在输入框/可编辑元素时用户正在打字:放行按键给输入,不触发任何快捷键或游戏键。
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  )
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return // 正在输入框打字,不抢按键
  if (props.inputLocked) return // 模态接管,游戏不收输入
  if (e.code === 'Escape') {
    e.preventDefault()
    if (!e.repeat) emit('systemAction', 'open-settings')
    return
  }
  if (e.code === 'F8') {
    e.preventDefault()
    if (!e.repeat) void quickSave()
    return
  }
  // 返回键(遥控器 BACK / Backspace / GoBack):交 App 分级返回(游戏中→停止游戏回主界面)。
  // 不区分平台:这些键在桌面游戏中本就空闲,无副作用;方向键照常落给 codeToAction(玩家)。
  if (e.code === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
    e.preventDefault()
    if (!e.repeat) emit('systemAction', 'back')
    return
  }
  // 应用级快捷键:修饰键由 modifier 决定(桌面 Ctrl / 浏览器 Shift,避开浏览器占用键)。
  // S=存档,L=读档,N=新建存档,A=存档列表,G=游戏库,P=暂停,F=全屏;Esc 打开设置,F8 快速存档。
  const modActive = props.modifier === 'ctrl' ? e.ctrlKey : e.shiftKey
  if (modActive) {
    switch (e.code) {
      case 'KeyS':
        e.preventDefault()
        if (!e.repeat) void quickSave()
        return
      case 'KeyL':
        e.preventDefault()
        if (!e.repeat) void quickLoad()
        return
      case 'KeyN':
        e.preventDefault()
        if (!e.repeat) void quickNewSave()
        return
      case 'KeyA':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'open-saves')
        return
      case 'KeyG':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'open-library')
        return
      case 'KeyP':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'toggle-pause')
        return
      case 'KeyF':
        e.preventDefault()
        if (!e.repeat) emit('systemAction', 'toggle-fullscreen')
        return
    }
  }
  if (props.gamePaused) return
  const a = codeToAction.value[e.code]
  if (!a) return
  e.preventDefault()
  a.forEach(({ player, pad }) => pressPad(player, pad, 'keyboard'))
}
function onKeyUp(e: KeyboardEvent) {
  if (isTypingTarget(e)) return
  if (props.inputLocked || props.gamePaused) return
  const a = codeToAction.value[e.code]
  if (!a) return
  e.preventDefault()
  a.forEach(({ player, pad }) => releasePad(player, pad, 'keyboard'))
}

// 每个逻辑按钮分别跟踪输入来源,任一来源仍按住时保持按下。
type InputSource = 'keyboard' | 'gamepad' | 'touch'
const heldInputs = new Map<string, Set<InputSource>>()
const enginePressed = new Set<Button>()
function syncButton(player: number, pad: number) {
  const btn = runnerButton(player, pad)
  if (btn === null) return
  const turbo = pad === PadButton.A ? PadButton.TurboA : pad === PadButton.B ? PadButton.TurboB : null
  const pressed = !!heldInputs.get(`${player}:${pad}`)?.size ||
    (turbo !== null && !!turboPressed.get(turboKey(player, turbo)))
  if (pressed === enginePressed.has(btn)) return
  if (pressed) { enginePressed.add(btn); runner?.press(btn) }
  else { enginePressed.delete(btn); runner?.release(btn) }
}
function pressPad(player: number, pad: number, source: InputSource) {
  const key = `${player}:${pad}`
  const sources = heldInputs.get(key) ?? new Set<InputSource>()
  if (sources.has(source)) return
  sources.add(source)
  heldInputs.set(key, sources)
  if (isTurbo(pad)) turboStart(player, pad)
  else syncButton(player, pad)
}
function releasePad(player: number, pad: number, source: InputSource) {
  const key = `${player}:${pad}`
  const sources = heldInputs.get(key)
  if (!sources?.delete(source)) return
  if (sources.size) return
  heldInputs.delete(key)
  if (isTurbo(pad)) turboEnd(player, pad)
  else syncButton(player, pad)
}

// ===== 连发(Turbo):引擎无此功能,前端定时反复 press/release 模拟 =====
// 以 `${player}:${pad}` 为键,双玩家各自独立连发。
const activeTurbo = new Set<string>()
const turboPressed = new Map<string, boolean>()
let turboTimer = 0

function turboKey(player: number, pad: number): string {
  return `${player}:${pad}`
}
function turboIntervalMs(): number {
  const hz = settings.misc.turboHz > 0 ? settings.misc.turboHz : 16
  // press 与 release 各占一拍,故频率 ×2。
  return Math.max(1, Math.round(1000 / (hz * 2)))
}
function turboTick() {
  activeTurbo.forEach((key) => {
    const [player, pad] = key.split(':').map(Number)
    const next = !turboPressed.get(key)
    turboPressed.set(key, next)
    syncButton(player, TURBO_TARGET[pad])
  })
}
function ensureTurboTimer() {
  if (turboTimer || activeTurbo.size === 0) return
  turboTimer = window.setInterval(turboTick, turboIntervalMs())
}
function turboStart(player: number, pad: number) {
  const key = turboKey(player, pad)
  if (activeTurbo.has(key)) return // 键盘自动重复时幂等
  activeTurbo.add(key)
  ensureTurboTimer()
}
function turboEnd(player: number, pad: number) {
  const key = turboKey(player, pad)
  if (!activeTurbo.has(key)) return
  activeTurbo.delete(key)
  turboPressed.set(key, false)
  syncButton(player, TURBO_TARGET[pad])
  if (activeTurbo.size === 0 && turboTimer) {
    clearInterval(turboTimer)
    turboTimer = 0
  }
}
// 频率变更时重建定时器。
watch(
  () => settings.misc.turboHz,
  () => {
    if (turboTimer) {
      clearInterval(turboTimer)
      turboTimer = 0
      ensureTurboTimer()
    }
  },
)

// ===== 实体手柄(Gamepad API,USB/蓝牙皆通过此接口)=====
// 手柄按键没有独立事件,需每帧轮询 navigator.getGamepads() 读取状态。
// 每玩家只读自动分配的手柄,并按该玩家独立保存的映射派发;
// 与键盘一样按边沿(本帧 active 集合相对上一帧的增减)触发 press/release。
let padRaf = 0
const padActive: Set<number>[] = [new Set<number>(), new Set<number>()]

// 手柄空闲肩键(游戏未占用)做应用级快捷键:LB(b4)=暂停/继续,RB(b5)=打开游戏库。
// 跨所有手柄取或,独立边沿检测,避免长按重复触发。
const sysPadPrev = { lb: false, rb: false }
function detectSystemPadButtons(pads: (Gamepad | null)[]) {
  let lb = false
  let rb = false
  for (const pad of pads) {
    if (!pad) continue
    const player = settings.players.find((p) => p.gamepadIndex === pad.index)
    const bound = new Set(Object.values(player?.padmap ?? {}))
    if (!bound.has('b4') && pad.buttons[4]?.pressed) lb = true
    if (!bound.has('b5') && pad.buttons[5]?.pressed) rb = true
  }
  if (lb && !sysPadPrev.lb) emit('systemAction', 'toggle-pause')
  if (rb && !sysPadPrev.rb) emit('systemAction', 'open-library')
  sysPadPrev.lb = lb
  sysPadPrev.rb = rb
}

// 切到后台时释放游戏输入。
function onVisibilityChange() {
  if (document.hidden) releaseAllGameInput()
}

// 锁定或失焦时释放所有已按下的游戏按钮与连发。
function releaseAllGameInput() {
  heldInputs.clear()
  enginePressed.clear()
  activeTurbo.clear()
  turboPressed.clear()
  if (turboTimer) {
    clearInterval(turboTimer)
    turboTimer = 0
  }
  const buttons = [
    PadButton.Up,
    PadButton.Down,
    PadButton.Left,
    PadButton.Right,
    PadButton.A,
    PadButton.B,
    PadButton.Start,
    PadButton.Select,
  ]
  for (let player = 0; player < settings.players.length; player++) {
    for (const pad of buttons) {
      const btn = runnerButton(player, pad)
      if (btn !== null) runner?.release(btn)
    }
  }
  padActive.forEach((s) => s.clear())
}

function pollGamepads() {
  padRaf = requestAnimationFrame(pollGamepads)
  syncGamepadAssignments()
  if (!runner) return
  if (props.inputLocked || document.hidden) return // 模态或后台不向游戏送输入(库内导航自行轮询)
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  detectSystemPadButtons(pads)
  if (props.gamePaused) return
  settings.players.forEach((p, pi) => {
    const pad = p.gamepadIndex !== null ? pads[p.gamepadIndex] : null
    const now = new Set<number>()
    if (pad) {
      const map = buildPadToButton(padmapFor(pi))
      for (const sig in map) {
        if (isPadSignalActive(pad, sig)) now.add(map[sig])
      }
      // 左摇杆(axes[0]=X,axes[1]=Y)始终兼作方向键,与十字键并存:
      // 默认叠加摇杆方向;该轴已被玩家自定义绑定时,以其配置为准。
      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      if (ax < -GAMEPAD_AXIS_THRESHOLD && map['a0-'] === undefined) now.add(PadButton.Left)
      else if (ax > GAMEPAD_AXIS_THRESHOLD && map['a0+'] === undefined) now.add(PadButton.Right)
      if (ay < -GAMEPAD_AXIS_THRESHOLD && map['a1-'] === undefined) now.add(PadButton.Up)
      else if (ay > GAMEPAD_AXIS_THRESHOLD && map['a1+'] === undefined) now.add(PadButton.Down)
    }
    const prev = padActive[pi] ?? new Set<number>()
    now.forEach((pb) => {
      if (!prev.has(pb)) pressPad(pi, pb, 'gamepad') // 新按下
    })
    prev.forEach((pb) => {
      if (!now.has(pb)) releasePad(pi, pb, 'gamepad') // 已松开
    })
    padActive[pi] = now
  })
}

// 触屏虚拟手柄(TouchControls)回调:仅控制玩家1(单屏双人不现实)。
// 首次按下顺带解锁音频(iOS 要求音频在用户手势内启动)。
function onTouchPress(pad: number) {
  if (props.inputLocked || props.gamePaused || document.hidden) return
  runner?.resumeAudio()
  pressPad(0, pad, 'touch')
}
function onTouchRelease(pad: number) {
  releasePad(0, pad, 'touch')
}

// ===== 显示设置 =====
/** 画面显示宽高比(宽/高)。 */
const ASPECT_RATIO: Record<Aspect, number> = {
  '1:1': NATIVE_W / NATIVE_H,
  '8:7': 8 / 7,
  '4:3': 4 / 3,
}

const canvasStyle = computed(() => ({
  imageRendering: settings.display.smoothing ? ('auto' as const) : ('pixelated' as const),
}))

/** 量测容器,按宽高比与整数倍缩放算出画面盒子尺寸并写入 frame。 */
function applyDisplaySize() {
  const wrap = displayRef.value
  const frame = frameRef.value
  if (!wrap || !frame) return
  const cw = wrap.clientWidth
  const ch = wrap.clientHeight
  if (cw <= 0 || ch <= 0) return
  const ar = ASPECT_RATIO[settings.display.aspect]
  // 在容器内放下宽高比为 ar 的最大矩形。
  let w = cw
  let h = w / ar
  if (h > ch) {
    h = ch
    w = h * ar
  }
  if (settings.display.integerScale && h >= NATIVE_H) {
    // 以原生 240 行为基准取整数倍,再按比例推算宽度。
    const scale = Math.max(1, Math.floor(h / NATIVE_H))
    h = NATIVE_H * scale
    w = h * ar
    // 若整数倍后超出容器,回退一档。
    if (w > cw || h > ch) {
      const s2 = Math.max(1, scale - 1)
      h = NATIVE_H * s2
      w = h * ar
    }
  }
  frame.style.width = `${Math.floor(w)}px`
  frame.style.height = `${Math.floor(h)}px`
}

let ro: ResizeObserver | null = null

onMounted(() => {
  runner = new NesRunner(canvasRef.value!)
  runner.setVolume(settings.audio.volume)
  runner.setSpeed(settings.misc.speed)
  // 防串键:Nostalgist/RetroArch 会给 canvas 设 tabindex 并在启动/点击时 focus(),
  // 而其内部键盘 handler 只要 event.target===canvas 就直接处理真实按键 —— 于是画面
  // 获得焦点后,真实键盘会绕过下面的自定义映射漏进引擎,且引擎虚拟键位(i/j/k/l)恰与
  // 玩家键冲突(如物理 J 被引擎当成"左"),表现为串键。我们所有输入都经 press/release
  // 以合成事件(显式带 target=canvas,不依赖焦点)喂引擎,引擎无需真实焦点,故让 canvas
  // 永不持有焦点:任何获得焦点的瞬间立即 blur,真实按键 target 便不再是 canvas 被引擎忽略。
  const canvas = canvasRef.value!
  canvas.addEventListener('focus', () => canvas.blur())
  canvas.blur()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAllGameInput)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('gamepadconnected', syncGamepadAssignments)
  window.addEventListener('gamepaddisconnected', syncGamepadAssignments)
  syncGamepadAssignments() // 进入时已连手柄则立即绑定
  padRaf = requestAnimationFrame(pollGamepads)
  ro = new ResizeObserver(() => applyDisplaySize())
  if (displayRef.value) ro.observe(displayRef.value)
  applyDisplaySize()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', releaseAllGameInput)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('gamepadconnected', syncGamepadAssignments)
  window.removeEventListener('gamepaddisconnected', syncGamepadAssignments)
  if (padRaf) cancelAnimationFrame(padRaf)
  padRaf = 0
  if (turboTimer) clearInterval(turboTimer)
  turboTimer = 0
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = 0
  ro?.disconnect()
  ro = null
  runner?.dispose()
  runner = null
})

// 设置变化 -> 同步到 runner 与画面尺寸。
watch(() => settings.players.map((p) => [p.keymap, p.padmap]), releaseAllGameInput, { deep: true })

watch(() => settings.audio.volume, (v) => runner?.setVolume(v))
watch(() => settings.misc.speed, (v) => runner?.setSpeed(v))
// 进入模态(锁定输入)时释放所有游戏按键,避免卡键。
watch(
  () => props.inputLocked || props.gamePaused,
  (locked) => {
    if (locked) releaseAllGameInput()
  },
)
watch(
  () => [settings.display.aspect, settings.display.integerScale],
  () => applyDisplaySize(),
)

// 全屏由 App 层统一管理(见 useFullscreen):对整个应用根容器全屏,
// 键盘 mod+F 经 systemAction('toggle-fullscreen') 上抛,本组件不再自行控制全屏。

// 暴露给父组件
async function loadRom(bytes: Uint8Array) {
  runner?.resumeAudio()
  await runner?.loadRom(bytes)
}
function reset() {
  runner?.reset()
}
function setAudioEnabled(on: boolean) {
  runner?.setAudioEnabled(on)
}
function pause() {
  runner?.pause()
}
function resume() {
  runner?.resumeAudio()
  runner?.resume()
}
function stop() {
  runner?.unload()
}

// 供存档列表面板使用:抓取当前引擎状态 / 把某条存档状态应用到引擎。
async function captureState(): Promise<SaveState | null> {
  return runner?.loaded ? ((await runner.saveState()) ?? null) : null
}
async function applyState(state: SaveState): Promise<boolean> {
  if (!runner?.loaded) return false
  const ok = await runner.loadState(state)
  showToast(ok ? '已读档' : '读档失败')
  return ok
}
defineExpose({
  loadRom,
  reset,
  setAudioEnabled,
  pause,
  resume,
  stop,
  quickSave,
  quickLoad,
  quickNewSave,
  captureState,
  applyState,
})
</script>

<template>
  <div
    class="screen-wrap"
    :class="{ 'without-controls': !layoutEditing && settings.misc.touchPad === 'never', 'always-controls': layoutEditing || settings.misc.touchPad === 'always' }"
    :style="{ background: settings.display.bgColor }"
  >
    <div ref="displayRef" class="display-area">
      <div ref="frameRef" class="frame">
        <canvas ref="canvasRef" class="screen" :style="canvasStyle" />
        <div v-if="settings.display.scanlines" class="scanlines" />
        <transition name="toast-fade">
          <div v-if="toast" class="toast">{{ toast }}</div>
        </transition>
      </div>

    </div>

    <!-- 触屏虚拟手柄(经典分离式,支持斜向与多点触控) -->
    <TouchControls
      :editing="layoutEditing"
      :disabled="inputLocked || gamePaused"
      :menu-disabled="inputLocked"
      :can-save="!!romKey && !inputLocked"
      @menu="emit('systemAction', 'open-settings')"
      @quick-save="quickSave"
      @press="onTouchPress"
      @release="onTouchRelease"
    />
  </div>
</template>

<style scoped>
.screen-wrap {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.display-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
/* 横屏让画面使用完整区域，触屏按键通过绝对定位叠加。 */
@media (pointer: coarse) and (orientation: portrait) {
  .screen-wrap:not(.without-controls) {
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
}
@media (orientation: portrait) {
  .screen-wrap.always-controls { grid-template-rows: repeat(2, minmax(0, 1fr)); }
}
/* 画面盒子尺寸由 JS 按宽高比/整数倍算出 */
.frame {
  position: relative;
  border-radius: 4px;
  overflow: hidden;
}
.screen {
  display: block;
  width: 100%;
  height: 100%;
  /* 画面拉伸填满盒子(盒子已是目标宽高比) */
  object-fit: fill;
  image-rendering: pixelated;
}
/* 存档/读档等操作的短暂屏幕提示 */
.toast {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 13px;
  border-radius: 6px;
  pointer-events: none;
  white-space: nowrap;
}
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
}
/* CRT 扫描线:横向半透明暗线叠加 */
.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.25) 2px,
    rgba(0, 0, 0, 0.25) 3px
  );
}
</style>
