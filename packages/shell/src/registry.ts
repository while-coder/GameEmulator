// Metadata only: the launcher never imports an emulator runtime.
export const emulators = [
  { id: 'nes', name: 'NES / FC', description: '红白机', detail: '8 位经典 · 本地 ROM · 即时存档', page: 'nes.html' },
] as const
export type EmulatorId = typeof emulators[number]['id']
