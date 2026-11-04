import { createApp, type Component } from 'vue'
import { configureAppBranding } from './branding'
import { configureWebInteractions } from '../../player-ui/interaction'
export function mountShell(component: Component, tv = false) {
  configureWebInteractions()
  configureAppBranding(tv)
  document.documentElement.dataset.theme = 'dark'
  return createApp(component).mount('#app')
}
