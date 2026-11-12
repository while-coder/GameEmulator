import type { ArcadeRunnerApi, Action, Archive } from '@game-emulator/arcade'
import { NativeSession } from './nes'
import type { NativeTransport } from './transport'

const bits: Record<Action, number> = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 }
const pad: Record<Action, number> = { b: 0, y: 3, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15, a: 1, x: 2, l: 4, r: 5 }
export class NativeArcadeRunner implements ArcadeRunnerApi {
  private session: NativeSession
  private closed = false
  private closing: Promise<void> = Promise.resolve()
  private muted = false
  private errorHandler?: (error: Error) => void
  readonly nativeInput = true
  constructor(private readonly canvas: HTMLCanvasElement, private readonly transport?: NativeTransport) {
    this.session = this.createSession()
  }
  private createSession() {
    const session = new NativeSession(this.canvas, this.transport, 'arcade')
    const map = Object.fromEntries((Object.keys(bits) as Action[]).map(action => [bits[action], `b${pad[action]}`]))
    session.configureInput([map, map], 16)
    session.setAudioEnabled(!this.muted)
    session.onError = this.errorHandler
    return session
  }
  get coreBuild() { return this.session.saveNamespace }
  get loaded() { return !this.closed && this.session.loaded }
  get aspectRatio() { return this.session.aspectRatio }
  set onError(value: ((error: Error) => void) | undefined) { this.errorHandler = value; this.session.onError = value }
  async load(game: Archive, dependencies: Archive[]) {
    await this.closing
    if (this.closed) { this.session = this.createSession(); this.closed = false }
    await this.session.loadArcade(game, dependencies)
  }
  press(player: number, action: Action) { this.session.pressRetro(player, bits[action], true) }
  release(player: number, action: Action) { this.session.pressRetro(player, bits[action], false) }
  pause() { this.session.pause() }
  resume() { this.session.resume() }
  reset() { this.session.reset() }
  setMuted(value: boolean) { this.muted = value; if (!this.closed) this.session.setAudioEnabled(!value) }
  syncDisplay(smoothing: boolean) { this.session.syncDisplay(smoothing, false) }
  async save() {
    const state = await this.session.saveState()
    if (!state) throw new Error('请先启动游戏')
    return new Blob([state as BlobPart])
  }
  async restore(state: Blob) {
    if (!await this.session.loadState(new Uint8Array(await state.arrayBuffer()))) throw new Error('请先启动游戏')
  }
  dispose() {
    if (this.closed) return this.closing
    this.closed = true
    this.closing = this.session.dispose()
    return this.closing
  }
}
