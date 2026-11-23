import { defineComponent, h } from 'vue'
import { ConsoleView, mountConsoleApp, registerConsoleRunnerFactory, type ConsoleSystem } from '@game-emulator/console'
import { NativeConsoleRunner } from '@game-emulator/android-native/console'
import { playerEntry, returnToLobby } from '@game-emulator/shell'
import './library.css'
export function startConsole(system: ConsoleSystem) {
  document.documentElement.classList.add('android-tv')
  registerConsoleRunnerFactory((canvas, id) => new NativeConsoleRunner(canvas, id))
  const entry = playerEntry()
  mountConsoleApp(defineComponent({ setup: () => () => h(ConsoleView, { system, entry, onLeave: returnToLobby }) }))
}
