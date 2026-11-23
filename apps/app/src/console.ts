import { playerEntry, returnToLobby } from '@game-emulator/shell'
import { defineComponent, h } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ConsoleView, mountConsoleApp, registerConsoleRunnerFactory, type ConsoleSystem } from '@game-emulator/console'
import { isAndroid, isTauri } from '@game-emulator/nes'
import { NativeConsoleRunner } from '@game-emulator/android-native/console'
import { createWebViewTransport } from '@game-emulator/android-native/transport'
import { provideDesktopFullscreen } from './useDesktopFullscreen'
export function startConsole(system: ConsoleSystem) {
  if (__TAURI_ANDROID__ || isTauri && isAndroid) registerConsoleRunnerFactory((canvas, id) => new NativeConsoleRunner(canvas, id, createWebViewTransport()))
  const entry = playerEntry()
  mountConsoleApp(defineComponent({ setup() {
    provideDesktopFullscreen()
    async function leave() {
      if (new URLSearchParams(location.search).has('child')) await invoke('close_emulator')
      else returnToLobby()
    }
    return () => h(ConsoleView, { system, entry, onLeave: leave })
  } }))
}
