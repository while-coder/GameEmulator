import { createApp, type Component } from 'vue'
import { configureAppBranding } from './branding'
export function mountShell(component: Component, tv = false) {
  configureAppBranding(tv)
  document.documentElement.dataset.theme = 'dark'
  return createApp(component).mount('#app')
}
