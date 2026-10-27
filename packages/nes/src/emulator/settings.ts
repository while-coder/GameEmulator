/**
 * 全局设置:按键映射(分玩家)、显示效果、音频、杂项。
 *
 * 引擎本身不提供这些应用级配置项,所有设置都在前端实现并持久化到
 * localStorage。各组件直接 import 这里的 reactive 单例 `settings` 使用,
 * 修改后由 watch 自动保存。
 *
 * 多人:输入按玩家分组(`settings.players`,索引 0=玩家1、1=玩家2),每个玩家
 * 各有独立的键盘映射、手柄映射与自动分配的实体手柄下标。逻辑按钮以 `PadButton` 表示
 * (与玩家无关),运行时再经 `runnerButton(player, pad)` 路由到引擎对应手柄。
 */
import { reactive, watch } from 'vue'
import { Button } from './runner'

/** 画面宽高比预设。1:1 为方像素(256:240),8:7 与 4:3 为常见的拉伸观感。 */
export type Aspect = '1:1' | '8:7' | '4:3'
/** 触屏手柄显示策略。 */
export type TouchPadMode = 'auto' | 'always' | 'never'
export type TouchLayoutGroup = 'dpad' | 'actions' | 'functionsLeft' | 'functionsRight'
export type TouchLayoutOrientation = 'portrait' | 'landscape'
export type TouchLayout = Record<TouchLayoutOrientation, Partial<Record<TouchLayoutGroup, { x: number; y: number }>>>

/** 逻辑手柄按钮(与玩家无关);设置与运行时输入派发均以此为单位。 */
export enum PadButton {
  Up = 0,
  Down = 1,
  Left = 2,
  Right = 3,
  A = 4,
  B = 5,
  TurboA = 6,
  TurboB = 7,
  Start = 8,
  Select = 9,
}

/** 单个玩家的输入配置。键盘与手柄映射均按玩家独立保存。 */
export interface PlayerConfig {
  /** PadButton -> KeyboardEvent.code。 */
  keymap: Record<number, string>
  /** PadButton -> 手柄输入标识。 */
  padmap: Padmap
  /** 当前会话自动分配的实体手柄下标;不持久化。 */
  gamepadIndex: number | null
}

/**
 * 手柄输入标识:`b{n}` 为 buttons[n];`a{n}+` / `a{n}-` 为 axes[n] 正/负方向。
 * 即 PadButton -> 标识 的一套手柄映射。
 */
export type Padmap = Record<number, string>

export interface Settings {
  touchLayout: TouchLayout
  /** 玩家输入配置,索引 0=玩家1、1=玩家2。 */
  players: PlayerConfig[]
  display: {
    /** true=双线性平滑,false=像素化(默认)。 */
    smoothing: boolean
    aspect: Aspect
    /** 仅按整数倍放大,避免像素抖动。 */
    integerScale: boolean
    /** CRT 扫描线滤镜。 */
    scanlines: boolean
    /** 画面区背景色。 */
    bgColor: string
  }
  audio: {
    /** 音量 0~1。 */
    volume: number
  }
  misc: {
    touchPad: TouchPadMode
    /** 运行速度倍率。 */
    speed: number
    /** 连发频率(次/秒)。 */
    turboHz: number
    /** 调试:在状态栏实时显示当前按下的按键(键盘/手柄/遥控)。 */
    showInputDebug: boolean
  }
}

/** 支持的玩家数。 */
export const PLAYER_COUNT = 2
export const PLAYER_LABELS = ['玩家1', '玩家2']

/** 判断一个逻辑按钮是否为连发(Turbo)虚拟键。 */
export function isTurbo(id: number): boolean {
  return id === PadButton.TurboA || id === PadButton.TurboB
}

/** 连发虚拟按钮 -> 实际触发的逻辑按钮。 */
export const TURBO_TARGET: Record<number, PadButton> = {
  [PadButton.TurboA]: PadButton.A,
  [PadButton.TurboB]: PadButton.B,
}

/** 逻辑按钮 -> 引擎按钮 [玩家1, 玩家2]。连发键不在此表(经 TURBO_TARGET 转换后再查)。 */
const RUNNER_BUTTON: Partial<Record<PadButton, [Button, Button]>> = {
  [PadButton.Up]: [Button.Joypad1Up, Button.Joypad2Up],
  [PadButton.Down]: [Button.Joypad1Down, Button.Joypad2Down],
  [PadButton.Left]: [Button.Joypad1Left, Button.Joypad2Left],
  [PadButton.Right]: [Button.Joypad1Right, Button.Joypad2Right],
  [PadButton.A]: [Button.Joypad1A, Button.Joypad2A],
  [PadButton.B]: [Button.Joypad1B, Button.Joypad2B],
  [PadButton.Start]: [Button.Joypad1Start, Button.Joypad2Start],
  [PadButton.Select]: [Button.Joypad1Select, Button.Joypad2Select],
}

/** 把(玩家,逻辑按钮)路由到引擎按钮;连发键返回 null(需先经 TURBO_TARGET)。 */
export function runnerButton(player: number, pad: PadButton): Button | null {
  const pair = RUNNER_BUTTON[pad]
  if (!pair) return null
  return pair[player] ?? null
}

/** 可重绑的按钮顺序与中文名,供设置界面与按键说明渲染。 */
export const PAD_BUTTON_LIST: { btn: PadButton; label: string }[] = [
  { btn: PadButton.Up, label: '上' },
  { btn: PadButton.Down, label: '下' },
  { btn: PadButton.Left, label: '左' },
  { btn: PadButton.Right, label: '右' },
  { btn: PadButton.A, label: 'A' },
  { btn: PadButton.B, label: 'B' },
  { btn: PadButton.TurboA, label: '连发A' },
  { btn: PadButton.TurboB, label: '连发B' },
  { btn: PadButton.Start, label: 'Start' },
  { btn: PadButton.Select, label: 'Select' },
]

export const SPEED_OPTIONS = [0.5, 1, 2, 3]
export const TURBO_HZ_OPTIONS = [8, 16, 24, 30]

/** 摇杆轴触发阈值:绝对值超过此值才视为对应方向按下,避免静止漂移误触。 */
export const GAMEPAD_AXIS_THRESHOLD = 0.5

// 标准手柄(W3C Standard Gamepad)默认映射:方向用 D-pad(b12~b15),A/B 取 Nintendo
// 手感(A 在右=b1,B 在下=b0),连发绑到面键 X/Y。每个玩家各自保存一份默认值。
export function defaultPadmap(): Padmap {
  return {
    [PadButton.Up]: 'b12',
    [PadButton.Down]: 'b13',
    [PadButton.Left]: 'b14',
    [PadButton.Right]: 'b15',
    [PadButton.A]: 'b1',
    [PadButton.B]: 'b0',
    [PadButton.TurboA]: 'b3',
    [PadButton.TurboB]: 'b2',
    [PadButton.Start]: 'b9',
    [PadButton.Select]: 'b8',
  }
}

function defaultSettings(): Settings {
  return {
    touchLayout: { portrait: {}, landscape: {} },
    players: [
      // 玩家1:键盘默认 WASD(方向)+ JK(B/A)+ UI(连发)。
      {
        keymap: {
          [PadButton.Up]: 'KeyW',
          [PadButton.Down]: 'KeyS',
          [PadButton.Left]: 'KeyA',
          [PadButton.Right]: 'KeyD',
          [PadButton.A]: 'KeyK',
          [PadButton.B]: 'KeyJ',
          [PadButton.TurboA]: 'KeyI',
          [PadButton.TurboB]: 'KeyU',
          [PadButton.Start]: 'Enter',
          [PadButton.Select]: 'Space',
        },
        padmap: defaultPadmap(),
        gamepadIndex: null,
      },
      // 玩家2:键盘默认方向键(方向)+ 小键盘(A/B/连发/开始)。
      {
        keymap: {
          [PadButton.Up]: 'ArrowUp',
          [PadButton.Down]: 'ArrowDown',
          [PadButton.Left]: 'ArrowLeft',
          [PadButton.Right]: 'ArrowRight',
          [PadButton.A]: 'Numpad2',
          [PadButton.B]: 'Numpad1',
          [PadButton.TurboA]: 'Numpad5',
          [PadButton.TurboB]: 'Numpad4',
          [PadButton.Start]: 'NumpadEnter',
          [PadButton.Select]: 'Numpad0',
        },
        padmap: defaultPadmap(),
        gamepadIndex: null,
      },
    ],
    display: {
      smoothing: false,
      aspect: '1:1',
      integerScale: false,
      scanlines: false,
      bgColor: '#000000',
    },
    audio: {
      volume: 1,
    },
    misc: {
      touchPad: 'auto',
      speed: 1,
      turboHz: 16,
      showInputDebug: false,
    },
  }
}

const STORAGE_KEY = 'nes.settings'

/** 把已存的单玩家配置与默认值合并,容忍缺字段。 */
function mergePlayer(base: PlayerConfig, saved: unknown): PlayerConfig {
  if (!saved || typeof saved !== 'object') return base
  const s = saved as Partial<PlayerConfig>
  return {
    keymap: { ...base.keymap, ...(s.keymap ?? {}) },
    padmap: { ...base.padmap, ...(s.padmap ?? {}) },
    gamepadIndex: null,
  }
}

/** 把已存的设置与默认值深合并,容忍缺字段/旧版本。 */
function merge(base: Settings, saved: unknown): Settings {
  if (!saved || typeof saved !== 'object') return base
  const s = saved as Partial<Settings>
  const savedPlayers = Array.isArray(s.players) ? s.players : []
  // 旧版按型号共享的档案迁入独立配置;能识别旧设备时优先按旧绑定迁移。
  const legacy = (saved as { gamepadProfiles?: Record<string, Padmap> }).gamepadProfiles ?? {}
  const pads = listGamepads()
  const profiles = Object.values(legacy)
  const touchLayout: TouchLayout = { portrait: {}, landscape: {} }
  for (const orientation of ['portrait', 'landscape'] as const) {
    for (const group of ['dpad', 'actions', 'functionsLeft', 'functionsRight'] as const) {
      const position = s.touchLayout?.[orientation]?.[group]
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        touchLayout[orientation][group] = {
          x: Math.max(0, Math.min(1, position.x)),
          y: Math.max(0, Math.min(1, position.y)),
        }
      }
    }
  }
  return {
    touchLayout,
    players: base.players.map((p, i) => {
      const old = savedPlayers[i]
      const merged = mergePlayer(p, old)
      if (!old?.padmap) {
        const id = pads.find((pad) => pad.index === old?.gamepadIndex)?.id
        const profile = id ? legacy[id] : profiles.length === 1 ? profiles[0] : undefined
        if (profile) merged.padmap = { ...p.padmap, ...profile }
      }
      return merged
    }),
    display: { ...base.display, ...(s.display ?? {}) },
    audio: { ...base.audio, ...(s.audio ?? {}) },
    misc: { ...base.misc, ...(s.misc ?? {}) },
  }
}

function load(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? merge(base, JSON.parse(raw)) : base
  } catch {
    return base
  }
}

export const settings = reactive<Settings>(load())

watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...s,
        players: s.players.map(({ keymap, padmap }) => ({ keymap, padmap })),
      }))
    } catch {
      // 忽略隐私模式等写入失败
    }
  },
  { deep: true },
)

/** 恢复全部设置为默认值(原地替换字段,保持响应式)。 */
export function resetSettings(): void {
  Object.assign(settings, defaultSettings())
}

/** 恢复指定玩家的键盘与手柄默认配置。 */
export function resetKeymap(player: number): void {
  const defaults = defaultSettings().players[player]
  settings.players[player].keymap = defaults.keymap
  settings.players[player].padmap = defaults.padmap
}

/** 手柄配置按玩家读取,保留显式解绑的空字符串。 */
export function padmapFor(player: number): Padmap {
  return settings.players[player].padmap
}

/** 同一玩家内,同一手柄输入仅绑定一个逻辑按钮。 */
export function setPadBinding(player: number, pad: PadButton, sig: string): void {
  const profile = settings.players[player].padmap
  for (const key of Object.keys(profile)) {
    if (profile[Number(key)] === sig && Number(key) !== pad) profile[Number(key)] = ''
  }
  profile[pad] = sig
}

// 保留已分配且仍连接的手柄,新识别的手柄依连接/激活顺序填补空位。
// 浏览器通常在首次按键后才向网页公开手柄,因此也支持按激活顺序分配。
export function syncGamepadAssignments(): void {
  const pads = listGamepads()
  const assigned = new Set<number>()
  for (const player of settings.players) {
    const index = player.gamepadIndex
    if (index !== null && pads.some((pad) => pad.index === index) && !assigned.has(index)) {
      assigned.add(index)
    } else {
      player.gamepadIndex = null
    }
  }
  for (const pad of pads) {
    if (assigned.has(pad.index)) continue
    const player = settings.players.find((p) => p.gamepadIndex === null)
    if (!player) break
    player.gamepadIndex = pad.index
    assigned.add(pad.index)
  }
}

/** 由 keymap 反推 code -> 按钮 id 查找表,供运行时按键派发。 */
export function buildCodeToButton(map: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, code] of Object.entries(map)) {
    if (code) out[code] = Number(id)
  }
  return out
}

/** 由 padmap 反推 手柄输入标识 -> 按钮 id 查找表,供运行时手柄派发。 */
export function buildPadToButton(map: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, sig] of Object.entries(map)) {
    if (sig) out[sig] = Number(id)
  }
  return out
}

/** 当前已连接的实体手柄列表(下标 + 名称),供设置界面分配玩家。 */
export function listGamepads(): { index: number; id: string }[] {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  const out: { index: number; id: string }[] = []
  for (const pad of pads) {
    if (pad?.connected) out.push({ index: pad.index, id: pad.id })
  }
  return out
}

/** 部分 KeyboardEvent.code 的友好显示名。 */
const CODE_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Space: '空格',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  Tab: 'Tab',
  Backspace: 'Backspace',
  NumpadEnter: 'Num Enter',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
}

/** 把 KeyboardEvent.code 显示成更友好的名字。 */
export function codeLabel(code: string | undefined): string {
  if (!code) return '未绑定'
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/^Arrow/, '')
}

/** 标准手柄(Standard Gamepad)按钮序号的常见名,仅作显示用。 */
const PAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Select',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
  16: 'Home',
}

/** 把手柄输入标识显示成更友好的名字(如 b1 -> "B"、a0- -> "摇杆←")。 */
export function padLabel(sig: string | undefined): string {
  if (!sig) return '未绑定'
  const b = /^b(\d+)$/.exec(sig)
  if (b) {
    const n = Number(b[1])
    return PAD_BUTTON_LABELS[n] ?? `键${n}`
  }
  const a = /^a(\d+)([+-])$/.exec(sig)
  if (a) return `摇杆${a[1]}${a[2] === '+' ? '+' : '−'}`
  return sig
}

/** 判断某个手柄输入标识在给定 Gamepad 当前是否处于按下/触发状态。 */
export function isPadSignalActive(pad: Gamepad, sig: string): boolean {
  const b = /^b(\d+)$/.exec(sig)
  if (b) {
    const btn = pad.buttons[Number(b[1])]
    return btn ? btn.pressed || btn.value > 0.5 : false
  }
  const a = /^a(\d+)([+-])$/.exec(sig)
  if (a) {
    const v = pad.axes[Number(a[1])]
    if (v === undefined) return false
    return a[2] === '+' ? v > GAMEPAD_AXIS_THRESHOLD : v < -GAMEPAD_AXIS_THRESHOLD
  }
  return false
}

/**
 * 扫描一个 Gamepad,返回当前正被按下的第一个输入标识(用于设置界面录入)。
 * 仅在该输入相对 baseline 发生变化时才识别,避免把扳机的静止偏置/已按住的键当成新输入。
 */
export function detectPadSignal(pad: Gamepad, baseline: Pick<Gamepad, 'buttons' | 'axes'> | null): string | null {
  for (let i = 0; i < pad.buttons.length; i++) {
    const pressed = pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5
    const was = baseline?.buttons[i]?.pressed || (baseline?.buttons[i]?.value ?? 0) > 0.5
    if (pressed && !was) return `b${i}`
  }
  for (let i = 0; i < pad.axes.length; i++) {
    const v = pad.axes[i]
    const base = baseline?.axes[i] ?? 0
    if (v > GAMEPAD_AXIS_THRESHOLD && base <= GAMEPAD_AXIS_THRESHOLD) return `a${i}+`
    if (v < -GAMEPAD_AXIS_THRESHOLD && base >= -GAMEPAD_AXIS_THRESHOLD) return `a${i}-`
  }
  return null
}
