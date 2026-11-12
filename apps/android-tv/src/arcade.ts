import { mountArcadeApp, registerArcadeRunnerFactory } from '@game-emulator/arcade'
import App from './ArcadeApp.vue'
import { NativeArcadeRunner } from '@game-emulator/android-native/arcade'
registerArcadeRunnerFactory(canvas => new NativeArcadeRunner(canvas))
mountArcadeApp(App)
