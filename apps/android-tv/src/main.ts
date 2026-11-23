import { mountShell } from '@game-emulator/shell'
import App from './App.vue'
document.documentElement.classList.add('android-tv')
mountShell(App, true)
