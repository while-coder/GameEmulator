export const nativeSaveBuilds = {
  nes: 'fceumm-e0f3086-native-v1',
  arcade: 'fbalpha2012-0ce3153-native-v1',
  gba: 'mgba-7a12d6d4-native-v1',
  sfc: 'snes9x-204ea1c0-native-v1',
} as const

export const wasmSaveBuilds = {
  nes: undefined,
  arcade: 'fbalpha2012-retroarch-1.22.2-a19485f4',
  gba: 'mgba-ra1.22.2-wasm-v1',
  sfc: 'snes9x-ra1.22.2-wasm-v1',
  psp: 'ppsspp-1.20.4-web-21294328-v1',
} as const
