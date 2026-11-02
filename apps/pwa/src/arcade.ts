import { mountArcadeApp } from '@game-emulator/arcade'
import ArcadeApp from './ArcadeApp.vue'
import { configureAppMetadata } from '@game-emulator/shell'
configureAppMetadata()
mountArcadeApp(ArcadeApp)
