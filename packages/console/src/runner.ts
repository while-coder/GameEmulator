/// <reference path="./env.d.ts" />
import { Nostalgist } from 'nostalgist'
import mgbaJs from './assets/mgba_libretro.js?url'
import mgbaWasm from './assets/mgba_libretro.wasm?url'
import snesJs from './assets/snes9x_libretro.js?url'
import snesWasm from './assets/snes9x_libretro.wasm?url'
import { systems, type Action, type ConsoleSystem } from './systems'
import { getBattery, putBattery, type SavedGame } from './store'

export interface ConsoleRunner {
  readonly build: string
  readonly nativeInput?: boolean
  onError?: (error: Error) => void
  load(game: SavedGame, signal: AbortSignal): Promise<void>
  pause(): void
  resume(): void
  reset(): void
  input(player: number, action: Action, down: boolean): void
  setSmoothing?(smoothing: boolean): void
  setMuted(muted: boolean): void
  save(): Promise<Uint8Array>
  restore(data: Uint8Array): Promise<void>
  flush(): Promise<void>
  dispose(): Promise<void>
}
type Factory = (canvas: HTMLCanvasElement, system: ConsoleSystem) => ConsoleRunner
let factory: Factory | undefined
export function registerConsoleRunnerFactory(value: Factory) { factory = value }
export function createConsoleRunner(canvas: HTMLCanvasElement, system: ConsoleSystem): ConsoleRunner { return factory?.(canvas, system) ?? new WasmConsoleRunner(canvas, system) }
const actions: Action[] = ['b', 'y', 'select', 'start', 'up', 'down', 'left', 'right', 'a', 'x', 'l', 'r']
const keys = ['z', 'a', 'rshift', 'enter', 'up', 'down', 'left', 'right', 'x', 's', 'q', 'w', 'c', 'd', 't', 'g', 'i', 'k', 'j', 'l', 'v', 'f', 'u', 'o']
const inputConfig = Object.fromEntries([0, 1].flatMap(player => actions.map((action, index) => [`input_player${player + 1}_${action}`, keys[player * 12 + index]])))

class WasmConsoleRunner implements ConsoleRunner {
  readonly build: string
  private instance: Awaited<ReturnType<typeof Nostalgist.prepare>> | null = null
  private batteryKey = ''
  private running = false
  private muted = false
  private readonly css: string
  private readonly removeProperty: (name: string) => string
  private flushing: Promise<void> = Promise.resolve()
  constructor(private canvas: HTMLCanvasElement, private system: ConsoleSystem) {
    this.build = `${systems[system].core}-ra1.22.2-wasm-v1`
    this.css = canvas.style.cssText; this.removeProperty = canvas.style.removeProperty.bind(canvas.style)
  }
  async load(game: SavedGame, signal: AbortSignal) {
    await this.dispose(); signal.throwIfAborted()
    this.batteryKey = `${this.system}:${game.hash}:${this.build}`
    const battery = await getBattery(this.batteryKey)
    signal.throwIfAborted()
    const gba = this.system === 'gba'
    try {
      this.instance = await Nostalgist.prepare({
        element: this.canvas, core: systems[this.system].core, signal,
        rom: { fileName: game.fileName, fileContent: game.file },
        ...(battery?.size ? { sram: battery } : {}),
        resolveCoreJs: () => gba ? mgbaJs : snesJs,
        resolveCoreWasm: () => gba ? mgbaWasm : snesWasm,
        respondToGlobalEvents: false,
        retroarchConfig: { ...inputConfig, video_smooth: false },
      })
      signal.throwIfAborted()
      this.instance.getOptions().signal = undefined
      await this.instance.start(); signal.throwIfAborted()
      this.canvas.style.removeProperty = this.removeProperty
      this.canvas.style.width = '100%'; this.canvas.style.height = '100%'
      this.muted = false; this.running = true; this.pause()
    } catch (error) { await this.dispose(); throw error }
  }
  pause() { if (this.instance && this.running) { this.instance.pause(); this.instance.getEmscripten().Module._cmd_pause(); this.running = false } }
  resume() { if (this.instance && !this.running) { this.instance.resume(); this.instance.getEmscripten().Module._cmd_unpause(); this.running = true } }
  reset() { this.instance?.restart() }
  input(player: number, action: Action, down: boolean) { if (this.instance) { if (down) this.instance.pressDown({ button: action, player: player + 1 }); else this.instance.pressUp({ button: action, player: player + 1 }) } }
  setMuted(muted: boolean) { if (this.instance && muted !== this.muted) { this.instance.sendCommand('MUTE'); this.muted = muted } }
  async save() { if (!this.instance) throw new Error('请先启动游戏'); const { state } = await this.instance.saveState(); return new Uint8Array(await state.arrayBuffer()) }
  async restore(data: Uint8Array) {
    if (!this.instance || !data.length) throw new Error('存档不可用')
    const running = this.running
    try { await this.instance.loadState(new Blob([data as BlobPart])) }
    finally { this.running = !running; if (running) this.resume(); else this.pause() }
  }
  flush() {
    const instance = this.instance, key = this.batteryKey
    const result = this.flushing.then(async () => {
      if (!instance || this.instance !== instance) return
      // Nostalgist.saveSRAM waits for a nonempty file even for cartridges without
      // battery RAM. RetroArch writes MEMFS synchronously; inspect its output so
      // those games can pause, switch and exit without a one-minute timeout.
      instance.getEmulator().callCommand('_cmd_savefiles')
      const fs = instance.getEmscriptenFS()
      const findSave = (directory: string): Uint8Array | undefined => {
        if (!fs.analyzePath(directory).exists) return
        for (const name of fs.readdir(directory)) {
          if (name === '.' || name === '..') continue
          const path = `${directory}/${name}`
          if (fs.isDir(fs.stat(path).mode)) { const data = findSave(path); if (data) return data }
          else if (name.endsWith('.srm') && fs.stat(path).size) return fs.readFile(path).slice()
        }
      }
      const data = findSave('/home/web_user/retroarch/userdata/saves')
      if (data?.length) await putBattery(key, new Blob([data as BlobPart]))
    })
    this.flushing = result.catch(() => {})
    return result
  }
  async dispose() {
    const instance = this.instance
    if (instance) {
      try { await this.flush() }
      finally { instance.exit({ removeCanvas: false }); this.instance = null; this.running = false }
    }
    this.canvas.style.removeProperty = this.removeProperty; this.canvas.style.cssText = this.css
  }
}
