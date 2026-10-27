import { reactive, watch } from 'vue'
export const GAMEPAD_AXIS_THRESHOLD = 0.5
export const ACTIONS = [
  { id: 'up', label: '上', pad: 12 }, { id: 'down', label: '下', pad: 13 },
  { id: 'left', label: '左', pad: 14 }, { id: 'right', label: '右', pad: 15 },
  { id: 'y', label: 'Y', pad: 3 }, { id: 'x', label: 'X', pad: 2 },
  { id: 'l', label: 'L', pad: 4 }, { id: 'b', label: 'B', pad: 0 },
  { id: 'a', label: 'A', pad: 1 }, { id: 'r', label: 'R', pad: 5 },
  { id: 'select', label: '投币', pad: 8 }, { id: 'start', label: '开始', pad: 9 },
] as const
export type Action = typeof ACTIONS[number]['id']
export type Keymap = Record<Action, string>
export const ACTION_BUTTONS = ACTIONS.slice(4, 10)
const DEFAULT_KEYS = [
  ['KeyW','KeyS','KeyA','KeyD','KeyU','KeyI','KeyO','KeyJ','KeyK','KeyL','Digit5','Digit1'],
  ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Numpad4','Numpad5','Numpad6','Numpad1','Numpad2','Numpad3','Digit6','Digit2'],
]
export function defaultKeymap(player: number): Keymap {
  return Object.fromEntries(ACTIONS.map((a,i)=>[a.id,DEFAULT_KEYS[player][i]])) as Keymap
}
interface Settings {
  players: Keymap[]
  smoothing: boolean
  aspect: 'auto' | '4:3' | '3:4'
  touch: 'auto' | 'always' | 'never'
  muted: boolean
}
const defaults: Settings = { players:[defaultKeymap(0),defaultKeymap(1)], smoothing:false, aspect:'auto', touch:'auto', muted:false }
function load(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem('arcade.settings') ?? 'null')
    if (!value || typeof value !== 'object') return defaults
    return {
      players:defaults.players.map((base,i)=>Object.fromEntries(ACTIONS.map(a=>[a.id,typeof value.players?.[i]?.[a.id]==='string'?value.players[i][a.id]:base[a.id]])) as Keymap),
      smoothing:value.smoothing===true,
      aspect:['auto','4:3','3:4'].includes(value.aspect)?value.aspect:'auto',
      touch:['auto','always','never'].includes(value.touch)?value.touch:'auto',
      muted:value.muted===true,
    }
  } catch { return defaults }
}
export const settings = reactive(load())
watch(settings, value=>{try {localStorage.setItem('arcade.settings',JSON.stringify(value))} catch {}},{deep:true})
export function bindKey(player: number, action: Action, code: string) {
  for(const a of ACTIONS) if(settings.players[player][a.id]===code)settings.players[player][a.id]=''
  settings.players[player][action]=code
}
export function keyLabel(code: string) {
  return code ? code.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Numpad/,'Num ').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→') : '未绑定'
}
