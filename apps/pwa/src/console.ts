import { h, defineComponent } from 'vue'
import { ConsoleView, mountConsoleApp, type ConsoleSystem } from '@game-emulator/console'
import { configureAppMetadata } from '@game-emulator/shell'
export function startConsole(system: ConsoleSystem) {
  configureAppMetadata()
  mountConsoleApp(defineComponent({ setup: () => () => h(ConsoleView, { system, onLeave: () => location.replace(new URL('index.html', location.href).href) }) }))
}
