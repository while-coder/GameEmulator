// Metadata only: the launcher never imports an emulator runtime.
export const emulators = [
  { id: 'nes', name: 'NES / FC', description: '红白机', detail: '8 位经典 · 在线游戏库 · 即时存档', page: 'nes.html' },
  { id: 'arcade', name: 'ARCADE', description: '街机', detail: '投币开局 · 双人六键 · 即时存档', page: 'arcade.html' },
  { id: 'gba', name: 'GBA / GB / GBC', description: '任天堂掌机 · mGBA', detail: '本地导入 · 自定义游戏源 · 即时存档', page: 'gba.html' },
  { id: 'sfc', name: 'SFC / SNES', description: '超级任天堂 · Snes9x', detail: '双人同玩 · 本地导入 · 即时存档', page: 'sfc.html' },
  { id: 'psp', name: 'PSP', description: '索尼掌机 · PPSSPP', detail: '本地导入 · 即时存档', page: 'psp.html' },
] as const
export type EmulatorId = typeof emulators[number]['id']
