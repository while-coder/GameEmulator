import './styles.css'
import { createApp, type Component } from 'vue'
import { configureWebInteractions } from '../../player-ui/interaction'

export function mountPlayerApp(rootComponent: Component, selector = '#app') {
  configureWebInteractions()
  document.documentElement.dataset.theme = 'dark'
  return createApp(rootComponent).mount(selector)
}
