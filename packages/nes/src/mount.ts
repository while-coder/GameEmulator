import './styles.css'
import { createApp, type Component } from 'vue'

export function mountPlayerApp(rootComponent: Component, selector = '#app') {
  document.documentElement.dataset.theme = 'dark'
  return createApp(rootComponent).mount(selector)
}
