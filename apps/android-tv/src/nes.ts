import { mountPlayerApp, registerNesRunnerFactory } from '@game-emulator/nes'
import App from './NesApp.vue'
import { NativeNesRunner } from '../../../packages/android-native/src/nes'
registerNesRunnerFactory(canvas => new NativeNesRunner(canvas))
mountPlayerApp(App)
