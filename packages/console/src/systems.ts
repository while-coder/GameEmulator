export type ConsoleSystem = 'gba' | 'sfc'
export type Action = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select'
export const RETRO: Record<Action, number> = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 }
export const KEYMAP: Record<Action, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyX', b: 'KeyZ', x: 'KeyS', y: 'KeyA', l: 'KeyQ', r: 'KeyW', start: 'Enter', select: 'ShiftRight' }
export const PADMAP: Record<Action, number> = { a: 1, b: 0, x: 3, y: 2, l: 4, r: 5, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 }
export const systems = {
  gba: { name: 'GBA / GB / GBC', catalogUrl: 'https://raw.githubusercontent.com/while-coder/gba-roms/main/catalog.json', core: 'mgba', extensions: ['gba', 'gb', 'gbc'], players: 1, aspect: 3 / 2, actions: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'] as Action[] },
  sfc: { name: 'SFC / SNES', catalogUrl: 'https://raw.githubusercontent.com/while-coder/sfc-roms/main/catalog.json', core: 'snes9x', extensions: ['sfc', 'smc'], players: 2, aspect: 4 / 3, actions: ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'] as Action[] },
} as const
export function romExtension(system: ConsoleSystem, name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (!(systems[system].extensions as readonly string[]).includes(extension)) throw new Error(`请选择 ${systems[system].extensions.map(ext => '.' + ext).join(' / ')} 文件；压缩包请先解压`)
  return extension
}
export function gameAspect(system: ConsoleSystem, name: string): number {
  return system === 'gba' && /\.(gb|gbc)$/i.test(name) ? 10 / 9 : systems[system].aspect
}

export function defaultKeymap(player: number): Record<Action, string> {
  return player === 0 ? { ...KEYMAP } : { ...KEYMAP, up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', a: 'KeyV', b: 'KeyC', x: 'KeyF', y: 'KeyD', l: 'KeyU', r: 'KeyO', start: 'KeyG', select: 'KeyT' }
}
export type ConsoleSettings = {
  muted: boolean
  smoothing: boolean
  aspect: 'auto' | '4:3' | '3:2' | '10:9' | '1:1'
  touch: 'auto' | 'always' | 'never'
  keymaps: Record<Action, string>[]
  touchLayout: Record<'portrait' | 'landscape', Partial<Record<string, import('../../player-ui/touchLayout').TouchControlLayout>>>
}
