/// <reference path="../env.d.ts" />

/**
 * NES 运行器:封装 Nostalgist.js(libretro/fceumm wasm 核心)的生命周期与输入。
 *
 * 与旧的 jsnes 实现不同,渲染、音频、帧循环全部由 Nostalgist/RetroArch 内部接管,
 * 本类只负责:载入 ROM、把逻辑按钮映射成 RetroArch 输入、存读档、暂停/继续、
 * 以及速度/音量的(降级)控制。核心文件(fceumm_libretro.js/.wasm)跟随
 * player 源码作为 Vite asset 打包,保证离线(Tauri)与 PWA 可用。
 */
import { Nostalgist } from 'nostalgist'
import fceummCoreJsUrl from '../assets/cores/fceumm_libretro.js?url'
import fceummCoreWasmUrl from '../assets/cores/fceumm_libretro.wasm?url'

/** 存档快照:RetroArch 的二进制 savestate(可直接存入 IndexedDB)。 */
export type SaveState = Uint8Array

const WIDTH = 256
const HEIGHT = 240

export enum Button {
  Poweroff = 0,
  Reset = 1,
  // 玩家1
  Joypad1A = 2,
  Joypad1B = 3,
  Joypad1Up = 4,
  Joypad1Down = 5,
  Joypad1Left = 6,
  Joypad1Right = 7,
  Joypad1Start = 8,
  Joypad1Select = 9,
  // 玩家2
  Joypad2A = 10,
  Joypad2B = 11,
  Joypad2Up = 12,
  Joypad2Down = 13,
  Joypad2Left = 14,
  Joypad2Right = 15,
  Joypad2Start = 16,
  Joypad2Select = 17,
}

type NostalgistInstance = Awaited<ReturnType<typeof Nostalgist.launch>>

/** 逻辑按钮 -> (libretro 按钮名, 玩家号)。libretro 按钮名用 SNES 布局的 a/b。 */
const NES_BUTTON: Partial<Record<Button, { button: string; player: number }>> = {
  [Button.Joypad1A]: { button: 'a', player: 1 },
  [Button.Joypad1B]: { button: 'b', player: 1 },
  [Button.Joypad1Up]: { button: 'up', player: 1 },
  [Button.Joypad1Down]: { button: 'down', player: 1 },
  [Button.Joypad1Left]: { button: 'left', player: 1 },
  [Button.Joypad1Right]: { button: 'right', player: 1 },
  [Button.Joypad1Start]: { button: 'start', player: 1 },
  [Button.Joypad1Select]: { button: 'select', player: 1 },
  [Button.Joypad2A]: { button: 'a', player: 2 },
  [Button.Joypad2B]: { button: 'b', player: 2 },
  [Button.Joypad2Up]: { button: 'up', player: 2 },
  [Button.Joypad2Down]: { button: 'down', player: 2 },
  [Button.Joypad2Left]: { button: 'left', player: 2 },
  [Button.Joypad2Right]: { button: 'right', player: 2 },
  [Button.Joypad2Start]: { button: 'start', player: 2 },
  [Button.Joypad2Select]: { button: 'select', player: 2 },
}

// Nostalgist 用「模拟键盘」实现 press/pressUp:pressDown('a', player) 会查
// input_player{player}_a 绑定的键名并触发对应合成事件。RetroArch 内建默认只覆盖
// 玩家1,玩家2 必须在此显式配键位,否则 pressDown 对玩家2 无效(getKeyboardCode 返回空)。
// 这些键名只是 Nostalgist 内部合成事件用的虚拟标识(合成事件不经真实 DOM 派发,
// 也不受 respondToGlobalEvents 影响),因此只需两玩家之间不冲突、均为合法键名即可,
// 与用户真实键盘无关(真实输入仍由 NesScreen 的自定义映射经 press/release 进入)。
const INPUT_CONFIG = {
  input_player1_up: 'i',
  input_player1_down: 'k',
  input_player1_left: 'j',
  input_player1_right: 'l',
  input_player1_a: 'x',
  input_player1_b: 'z',
  input_player1_start: 'n',
  input_player1_select: 'm',
  input_player2_up: 'w',
  input_player2_down: 's',
  input_player2_left: 'a',
  input_player2_right: 'd',
  input_player2_a: 'q',
  input_player2_b: 'e',
  input_player2_start: 't',
  input_player2_select: 'y',
} as const

/** 速度状态:RetroArch 只有快进/慢放两个 toggle,任意倍速被降级为这三档。 */
type SpeedMode = 'normal' | 'ff' | 'slow'

export class NesRunner {
  private readonly canvas: HTMLCanvasElement
  private instance: NostalgistInstance | null = null
  private running = false

  private volume = 1
  private audioEnabled = true
  private speed = 1
  // 已下发到 RetroArch 的状态,用于把 toggle 命令(FAST_FORWARD/SLOWMOTION/MUTE)
  // 稳定映射成幂等的目标状态,避免重复发命令切反。
  private speedMode: SpeedMode = 'normal'
  private muted = false
  // 保存 canvas 初始状态,以便每次 destroy 后恢复。
  // Nostalgist launch 时会:
  //   1) 给 canvas 写 inline appearance 样式(backgroundColor / imageRendering);
  //   2) 劫持 canvas.style.removeProperty,拦住 width/height 不让删;
  //   3) Emscripten runtime 会把 canvas 的 CSS 尺寸写死为内部分辨率(256x240)。
  // 二次 launch 时这些遮盖 → canvas 变成 256x240 硬尺寸,跨出 frame 又位移。
  private readonly originalCssText: string
  private readonly originalRemoveProperty: (property: string) => string

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.originalCssText = canvas.style.cssText
    this.originalRemoveProperty = canvas.style.removeProperty.bind(canvas.style)
    // 设定内部分辨率;实际显示尺寸由 NesScreen 的 CSS 盒子控制,Nostalgist size:'auto'
    // 会按元素尺寸自适应,不覆盖这里的宽高比语义。
    canvas.width = WIDTH
    canvas.height = HEIGHT
  }

  /** 把 canvas 恢复到 launch 前的状态,清理 Nostalgist / Emscripten 遗留的 inline 样式与方法劫持。 */
  private restoreCanvas(): void {
    // 先把被劫持的 removeProperty 换回原生,下面 cssText 重置才不会丢掉 width/height。
    this.canvas.style.removeProperty = this.originalRemoveProperty
    // 一句把所有 inline 样式回到初始值(空字符串也能用,相当于清空)。
    this.canvas.style.cssText = this.originalCssText
    // 恢复内部分辨率属性(不是样式,是 canvas 自己的 width/height 属性)。
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
  }

  /** 载入并启动一个 ROM。 */
  async loadRom(bytes: Uint8Array): Promise<void> {
    await this.destroy()
    this.instance = await Nostalgist.launch({
      element: this.canvas,
      core: 'fceumm',
      rom: { fileName: 'game.nes', fileContent: new Blob([bytes as BlobPart]) },
      resolveCoreJs: () => fceummCoreJsUrl,
      resolveCoreWasm: () => fceummCoreWasmUrl,
      // 不让 RetroArch 监听真实全局键盘,输入完全由前端自定义系统经 press/release 派发,
      // 避免真实按键被 RetroArch 二次捕获导致重复输入。
      respondToGlobalEvents: false,
      retroarchConfig: INPUT_CONFIG,
    })
    this.running = true
    // 新实例回到默认(正常速度、未静音),按当前设置重新应用。
    this.speedMode = 'normal'
    this.muted = false
    this.applySpeed()
    this.applyMute()
  }

  /** 销毁当前实例(幂等)。 */
  private async destroy(): Promise<void> {
    if (this.instance) {
      try {
        // 关键:removeCanvas: false 保留 Vue 持有的 <canvas>。
        // 默认 exit() 会把 canvas 从 DOM 移除,下次 launch 仍传入同一 canvasRef 时
        // Nostalgist 会挂新的 canvas 到别处,frame 里那块变成死画布 -> 二次加载黑屏。
        this.instance.exit({ removeCanvas: false })
      } catch (err) {
        console.warn('[NES] 退出核心实例出错', err)
      }
      this.instance = null
      // 清理 Nostalgist / Emscripten 写入的 inline 样式与方法劫持,不然二次 launch 时
      // canvas 会带着硬尺寸 256x240,导致画面变小并往下堆。
      this.restoreCanvas()
    }
    this.running = false
    this.speedMode = 'normal'
    this.muted = false
  }

  // ===== 速度(降级):>1 快进、<1 慢放、=1 正常 =====
  private applySpeed(): void {
    if (!this.instance) return
    const target: SpeedMode = this.speed > 1 ? 'ff' : this.speed < 1 ? 'slow' : 'normal'
    if (target === this.speedMode) return
    // 先关闭当前非正常态,再开启目标态(FAST_FORWARD/SLOWMOTION 均为 toggle)。
    if (this.speedMode === 'ff') this.instance.sendCommand('FAST_FORWARD')
    else if (this.speedMode === 'slow') this.instance.sendCommand('SLOWMOTION')
    if (target === 'ff') this.instance.sendCommand('FAST_FORWARD')
    else if (target === 'slow') this.instance.sendCommand('SLOWMOTION')
    this.speedMode = target
  }

  // ===== 音量(降级):RetroArch 无 setVolume,滑块归结为静音开关 =====
  private applyMute(): void {
    if (!this.instance) return
    const shouldMute = !this.audioEnabled || this.volume <= 0
    if (shouldMute === this.muted) return
    this.instance.sendCommand('MUTE')
    this.muted = shouldMute
  }

  /** 浏览器要求音频在用户手势后才能播放;RetroArch 自管音频上下文,故为空实现(保留调用方兼容)。 */
  resumeAudio(): void {}

  setAudioEnabled(on: boolean): void {
    this.audioEnabled = on
    this.applyMute()
  }

  /** 设置音量 0~1(降级:0 静音,>0 开启)。 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyMute()
  }

  /** 设置运行速度倍率(降级:>1 快进,<1 慢放,=1 正常)。 */
  setSpeed(n: number): void {
    this.speed = n > 0 ? n : 1
    this.applySpeed()
  }

  /** 暂停帧循环(可恢复)。 */
  pause(): void {
    if (this.instance && this.running) {
      this.instance.pause()
      this.running = false
    }
  }

  /** 从暂停状态恢复运行。 */
  resume(): void {
    if (this.instance && !this.running) {
      this.instance.resume()
      this.running = true
    }
  }

  /** 帧循环是否正在运行。 */
  get isRunning(): boolean {
    return this.running
  }

  /** 中止并卸载当前 ROM,回到未载入状态(可再次 loadRom)。 */
  unload(): void {
    void this.destroy()
  }

  reset(): void {
    this.instance?.restart()
  }

  /** 导出当前引擎状态为存档快照;未载入 ROM 时返回 null。 */
  async saveState(): Promise<SaveState | null> {
    if (!this.instance) return null
    const { state } = await this.instance.saveState()
    return new Uint8Array(await state.arrayBuffer())
  }

  /**
   * 从存档快照恢复引擎状态。需先载入对应 ROM(同一卡带)。
   * 返回是否成功(状态损坏或格式不符时返回 false,不影响当前运行)。
   */
  async loadState(state: SaveState): Promise<boolean> {
    if (!this.instance) return false
    try {
      await this.instance.loadState(new Blob([state as BlobPart]))
      return true
    } catch (err) {
      console.error('[NES] 读取存档失败', err)
      return false
    }
  }

  press(button: Button): void {
    if (button === Button.Reset) {
      this.reset()
      return
    }
    if (button === Button.Poweroff) {
      this.unload()
      return
    }
    const m = NES_BUTTON[button]
    if (m && this.instance) this.instance.pressDown({ button: m.button, player: m.player })
  }

  release(button: Button): void {
    const m = NES_BUTTON[button]
    if (m && this.instance) this.instance.pressUp({ button: m.button, player: m.player })
  }

  /** 是否已载入 ROM。 */
  get loaded(): boolean {
    return this.instance !== null
  }

  /** 释放资源。 */
  dispose(): void {
    void this.destroy()
  }
}

export const SCREEN = { WIDTH, HEIGHT }
