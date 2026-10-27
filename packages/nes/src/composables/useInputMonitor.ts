/**
 * 输入调试监视:在 window 层捕获所有按键(键盘、遥控器、实体手柄)并汇成一行
 * 文本,供状态栏实时显示,方便排查按键映射 / 遥控器键值 / 手柄按钮编号。
 *
 * 与游戏输入(NesScreen)完全解耦:直接挂 window 监听 + 轮询 gamepad,不受模态
 * 锁定 / 是否已载入游戏影响,因此连未绑定到游戏的键(遥控器 BACK、手柄空闲键等)
 * 也能看到。仅在 `settings.misc.showInputDebug` 开启时才附加监听,关闭时零开销。
 *
 * 显示取原始标识而非友好名 —— 键盘用 `KeyboardEvent.code`(遥控器特殊键 code 为空时
 * 退回 key),手柄用 `b{n}` / `a{n}±` —— 这些正是按键映射录入所用的标识,调试最直接。
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { GAMEPAD_AXIS_THRESHOLD, settings } from '../emulator/settings'

export interface InputMonitorApi {
  /** 当前按下的所有按键描述,未按任何键时为空串(全部松开后短暂保留再清空)。 */
  label: Ref<string>
}

/** 全部松开后保留最后一次显示的时长(ms),便于看清瞬时按下的键。 */
const HOLD_MS = 900

export function useInputMonitor(): InputMonitorApi {
  const label = ref('')
  // 当前按下的键 -> 显示文本;保持插入顺序(≈按下先后)。
  // 键盘条目键为 `k:{id}`,手柄条目键为 `g:{index}:{sig}`。
  const pressed = new Map<string, string>()
  let raf = 0
  let clearTimer = 0

  function refresh() {
    const next = [...pressed.values()].join('   ')
    if (next) {
      if (clearTimer) {
        clearTimeout(clearTimer)
        clearTimer = 0
      }
      if (next !== label.value) label.value = next
    } else if (label.value && !clearTimer) {
      // 全松开:保留片刻再清,避免瞬按一闪而过看不清。
      clearTimer = window.setTimeout(() => {
        label.value = ''
        clearTimer = 0
      }, HOLD_MS)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const id = e.code || e.key
    if (!id) return
    const key = `k:${id}`
    if (pressed.has(key)) return // 键盘自动重复:幂等
    pressed.set(key, `⌨ ${id}`)
    refresh()
  }
  function onKeyUp(e: KeyboardEvent) {
    const id = e.code || e.key
    if (pressed.delete(`k:${id}`)) refresh()
  }

  // 手柄无事件,每帧轮询所有手柄的按钮 / 轴,按边沿维护 pressed 里的 `g:` 条目。
  function pollPads() {
    raf = requestAnimationFrame(pollPads)
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const now = new Set<string>()
    for (const pad of pads) {
      if (!pad) continue
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i]
        if (b && (b.pressed || b.value > 0.5)) {
          const key = `g:${pad.index}:b${i}`
          now.add(key)
          if (!pressed.has(key)) pressed.set(key, `🎮#${pad.index} b${i}`)
        }
      }
      for (let i = 0; i < pad.axes.length; i++) {
        const v = pad.axes[i]
        if (v > GAMEPAD_AXIS_THRESHOLD) {
          const key = `g:${pad.index}:a${i}+`
          now.add(key)
          if (!pressed.has(key)) pressed.set(key, `🎮#${pad.index} a${i}+`)
        } else if (v < -GAMEPAD_AXIS_THRESHOLD) {
          const key = `g:${pad.index}:a${i}-`
          now.add(key)
          if (!pressed.has(key)) pressed.set(key, `🎮#${pad.index} a${i}-`)
        }
      }
    }
    // 移除已松开的手柄条目(键盘条目由 keyup 维护,不在此清理)。
    for (const key of pressed.keys()) {
      if (key.startsWith('g:') && !now.has(key)) pressed.delete(key)
    }
    refresh()
  }

  // 用捕获阶段监听,确保先于游戏/模态逻辑收到,且我们不 preventDefault,不干扰原有行为。
  function start() {
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    if (!raf) raf = requestAnimationFrame(pollPads)
  }
  function stop() {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = 0
    }
    pressed.clear()
    label.value = ''
  }

  watch(
    () => settings.misc.showInputDebug,
    (on) => (on ? start() : stop()),
  )

  onMounted(() => {
    if (settings.misc.showInputDebug) start()
  })
  onBeforeUnmount(stop)

  return { label }
}
