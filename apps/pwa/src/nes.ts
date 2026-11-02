import { mountPlayerApp } from '@game-emulator/nes'
import NesApp from './NesApp.vue'
import { configureAppMetadata } from '@game-emulator/shell'
configureAppMetadata()
mountPlayerApp(NesApp)
