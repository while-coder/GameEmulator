import { mountArcadeApp, registerArcadeRunnerFactory } from '@game-emulator/arcade'
import App from './ArcadeApp.vue'
import { NativeArcadeRunner } from '../../../packages/android-native/src/arcade'
registerArcadeRunnerFactory(canvas => new NativeArcadeRunner(canvas))
mountArcadeApp(App)
