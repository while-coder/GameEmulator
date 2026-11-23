export const emulators = [
  { id: 'nes', page: 'nes.html' },
  { id: 'arcade', page: 'arcade.html' },
  { id: 'gba', page: 'gba.html' },
  { id: 'sfc', page: 'sfc.html' },
  { id: 'psp', page: 'psp.html' },
] as const
export type EmulatorId = typeof emulators[number]['id']
