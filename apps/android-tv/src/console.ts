import { defineComponent, h } from 'vue'
import { ConsoleView, mountConsoleApp, registerConsoleRunnerFactory, type ConsoleSystem } from '@game-emulator/console'
import { NativeConsoleRunner } from '@game-emulator/android-native/console'
import './library.css'
export function startConsole(system: ConsoleSystem) {
  document.documentElement.classList.add('android-tv')
  registerConsoleRunnerFactory((canvas, id) => new NativeConsoleRunner(canvas, id))
  mountConsoleApp(defineComponent({ setup: () => () => h(ConsoleView, { system, onLeave: () => location.replace(new URL('index.html', location.href).href) }) }))
}
