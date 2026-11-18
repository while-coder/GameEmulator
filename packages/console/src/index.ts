import './styles.css'
import { createApp, type Component } from 'vue'
import { configureWebInteractions } from '../../player-ui/interaction'
export { default as ConsoleView } from './ConsoleView.vue'
export { registerConsoleRunnerFactory, type ConsoleRunner } from './runner'
export { systems, RETRO, PADMAP, type ConsoleSystem, type Action } from './systems'
export type { SavedGame } from './store'
export function mountConsoleApp(component: Component) {
  configureWebInteractions()
  document.documentElement.dataset.theme = 'dark'
  return createApp(component).mount('#app')
}
