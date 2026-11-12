import { mountArcadeApp, registerArcadeRunnerFactory } from '@game-emulator/arcade'
import { isAndroid, isTauri } from '@game-emulator/nes'
import ArcadeApp from './ArcadeApp.vue'
import { NativeArcadeRunner } from '@game-emulator/android-native/arcade'
import { createWebViewTransport } from '@game-emulator/android-native/transport'
if (__TAURI_ANDROID__ || (isTauri && isAndroid)) registerArcadeRunnerFactory(canvas => new NativeArcadeRunner(canvas, createWebViewTransport()))
mountArcadeApp(ArcadeApp)
