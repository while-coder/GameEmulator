import { mountArcadeApp, registerArcadeRunnerFactory } from '@game-emulator/arcade'
import App from './ArcadeApp.vue'
import './library.css'
import { NativeArcadeRunner } from '@game-emulator/android-native/arcade'
registerArcadeRunnerFactory(canvas => new NativeArcadeRunner(canvas))
document.documentElement.classList.add('android-tv')
mountArcadeApp(App)
