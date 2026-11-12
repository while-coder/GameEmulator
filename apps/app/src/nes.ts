import { mountPlayerApp, registerNesRunnerFactory, isAndroid, isTauri } from '@game-emulator/nes'
import NesApp from './NesApp.vue'
import { NativeNesRunner } from '@game-emulator/android-native/nes'
import { createWebViewTransport } from '@game-emulator/android-native/transport'
if (__TAURI_ANDROID__ || (isTauri && isAndroid)) registerNesRunnerFactory(canvas => new NativeNesRunner(canvas, createWebViewTransport()))
mountPlayerApp(NesApp)
