import { mountPlayerApp, registerNesRunnerFactory, isAndroid, isTauri } from '@game-emulator/nes'
import NesApp from './NesApp.vue'
import { NativeNesRunner } from '../../../packages/android-native/src/nes'
import { createWebViewTransport } from '../../../packages/android-native/src/transport'
if (__TAURI_ANDROID__ || (isTauri && isAndroid)) registerNesRunnerFactory(canvas => new NativeNesRunner(canvas, createWebViewTransport()))
mountPlayerApp(NesApp)
