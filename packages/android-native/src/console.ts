import { RETRO, PADMAP, type Action, type ConsoleRunner, type ConsoleSystem, type SavedGame } from '@game-emulator/console'
import { NativeSession } from './nes'
import { httpNativeTransport, type NativeTransport } from './transport'

export class NativeConsoleRunner implements ConsoleRunner {
  readonly nativeInput = true
  readonly build: string
  private readonly session: NativeSession
  onError?: (error: Error) => void
  constructor(canvas: HTMLCanvasElement, system: ConsoleSystem, transport: NativeTransport = httpNativeTransport) {
    this.session = new NativeSession(canvas, transport, system)
    this.build = this.session.saveNamespace
    this.session.onError = error => this.onError?.(error)
  }
  async load(game: SavedGame, signal: AbortSignal) {
    await this.session.loadRom(new Uint8Array(await game.file.arrayBuffer()), signal, game.fileName)
    this.session.setSpeed(1)
    this.session.setDebug(false)
    const map = Object.fromEntries(Object.entries(PADMAP).map(([action, button]) => [RETRO[action as Action], `b${button}`]))
    this.session.configureInput([map, map], 16)
  }
  pause() { this.session.pause() }
  resume() { this.session.resume() }
  reset() { this.session.reset() }
  input(player: number, action: Action, down: boolean) { this.session.pressRetro(player, RETRO[action], down) }
  setSmoothing(smoothing: boolean) { this.session.syncDisplay(smoothing, false) }
  setMuted(muted: boolean) { this.session.setAudioEnabled(!muted) }
  async save() { const state = await this.session.saveState(); if (!state?.length) throw new Error('内核返回了空存档'); return state }
  async restore(data: Uint8Array) { if (!await this.session.loadState(data)) throw new Error('读取存档失败') }
  async flush() { /* Native host persists SRAM periodically and on pause/unload. */ }
  dispose() { return this.session.dispose() }
}
