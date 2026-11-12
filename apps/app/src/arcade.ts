import { mountArcadeApp, registerArcadeRunnerFactory } from '@game-emulator/arcade'
import { isAndroid, isTauri } from '@game-emulator/nes'
import ArcadeApp from './ArcadeApp.vue'
import { NativeArcadeRunner } from '../../../packages/android-native/src/arcade'
import { createWebViewTransport } from '../../../packages/android-native/src/transport'
if (__TAURI_ANDROID__ || (isTauri && isAndroid)) registerArcadeRunnerFactory(canvas => new NativeArcadeRunner(canvas, createWebViewTransport()))
mountArcadeApp(ArcadeApp)
