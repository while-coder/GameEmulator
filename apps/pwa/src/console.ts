import { h, defineComponent } from 'vue'
import { ConsoleView, mountConsoleApp, type ConsoleSystem } from '@game-emulator/console'
import { configureAppMetadata, playerEntry, returnToLobby } from '@game-emulator/shell'
export function startConsole(system: ConsoleSystem) {
  configureAppMetadata()
  const entry = playerEntry()
  mountConsoleApp(defineComponent({ setup: () => () => h(ConsoleView, { system, entry, onLeave: returnToLobby }) }))
}
