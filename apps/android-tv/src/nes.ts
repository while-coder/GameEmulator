import { mountPlayerApp, registerNesRunnerFactory } from '@game-emulator/nes'
import App from './NesApp.vue'
import './library.css'
import { NativeNesRunner } from '@game-emulator/android-native/nes'
registerNesRunnerFactory(canvas => new NativeNesRunner(canvas))
document.documentElement.classList.add('android-tv')
mountPlayerApp(App)
