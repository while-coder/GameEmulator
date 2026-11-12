import { mountPlayerApp, registerNesRunnerFactory } from '@game-emulator/nes'
import App from './NesApp.vue'
import { NativeNesRunner } from '@game-emulator/android-native/nes'
registerNesRunnerFactory(canvas => new NativeNesRunner(canvas))
mountPlayerApp(App)
