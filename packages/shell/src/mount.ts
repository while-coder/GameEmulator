import { createApp, type Component } from 'vue'
export function mountShell(component: Component) {
  document.documentElement.dataset.theme = 'dark'
  return createApp(component).mount('#app')
}
