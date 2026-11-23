import runtimeUrl from './assets/psp/PPSSPPSDL.js?url'
import wasmUrl from './assets/psp/PPSSPPSDL.wasm?url'
import assetsUrl from './assets/psp/PPSSPPSDL.data?url'
import type { ConsoleRunner } from './runner'
import { PADMAP, romExtension, type Action } from './systems'
import { getPspSavedata, putPspSavedata, type SavedGame, type PspSaveFile } from './store'
import { wasmSaveBuilds } from '../../shared/saveBuilds'

type FileSystem = {
  mkdirTree(path: string): void
  analyzePath(path: string): { exists: boolean }
  readdir(path: string): string[]
  isDir(mode: number): boolean
  stat(path: string): { mode: number; size: number; mtime: Date }
  readFile(path: string): Uint8Array
  writeFile(path: string, data: string | Uint8Array, options?: { canOwn: boolean }): void
  unlink(path: string): void
}
type RuntimeWindow = Window & typeof globalThis & {
  Module: object
  FS: FileSystem
  ENV: Record<string, string>
  MainLoop: { preMainLoop: (() => boolean)[]; postMainLoop: (() => void)[] }
}

const systemDirectory = '/home/web_user/.config/ppsspp/PSP/SYSTEM'
const savesDirectory = '/home/web_user/.config/ppsspp/PSP/SAVEDATA'
const statesDirectory = '/home/web_user/.config/ppsspp/PSP/PPSSPP_STATE'
const slotFile = /^[^/\\\0]+_0\.ppst$/
const controls = [
  '[ControlMapping]',
  'Save State = 1-132', 'Load State = 1-134', 'Reset = 1-136',
  'Cross = 10-96', 'Circle = 10-97', 'Square = 10-99', 'Triangle = 10-100',
  'L = 10-102', 'R = 10-103', 'Start = 10-108', 'Select = 10-109',
  'Up = 10-19', 'Down = 10-20', 'Left = 10-21', 'Right = 10-22',
  'An.Right = 10-4000', 'An.Left = 10-4001', 'An.Up = 10-4003', 'An.Down = 10-4002',
].join('\n')

function pspUnavailable(): string {
  return window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
    ? '' : '当前浏览环境未启用 WASM 多线程。请使用支持跨源隔离的浏览器或应用版本。'
}

function frameLoaded(frame: HTMLIFrameElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    frame.addEventListener('load', () => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, { once: true })
  })
}

export class PspRunner implements ConsoleRunner {
  readonly build = wasmSaveBuilds.psp
  onError?: (error: Error) => void
  private frame?: HTMLIFrameElement
  private win?: RuntimeWindow
  private screen?: HTMLCanvasElement
  private started = false
  private stateActive = false
  private renderedFrames = 0
  private copySaveFrame?: () => void
  private readonly buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
  private readonly axes = [0, 0, 0, 0]
  private readonly audioContexts = new Set<AudioContext>()
  private flushing: Promise<void> = Promise.resolve()
  private cleanup: Promise<void> = Promise.resolve()
  private saveSignature = ''
  private lifetime = new AbortController()
  private running = false
  private muted = false
  private bootCount = 0
  private pendingLoad?: { path: string; result?: boolean }

  constructor(private canvas: HTMLCanvasElement) {}

  async load(game: SavedGame, signal: AbortSignal) {
    const unavailable = pspUnavailable()
    if (unavailable) throw new Error(unavailable)
    const startup = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(90_000)])
    const [savedata, buffer] = await Promise.all([getPspSavedata(), game.file.arrayBuffer()])
    startup.throwIfAborted()

    // Destroying the frame also releases the SDL context and its worker pool.
    const frame = this.frame = document.createElement('iframe')
    frame.className = 'console-psp-frame'
    frame.title = 'PSP 游戏画面'
    frame.tabIndex = -1
    frame.setAttribute('allow', 'autoplay; cross-origin-isolated')
    frame.srcdoc = '<!doctype html><meta charset="utf-8"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}canvas{display:block;width:100%!important;height:100%!important}</style><canvas id="canvas" width="480" height="272"></canvas>'
    const ready = frameLoaded(frame, startup)
    this.canvas.after(frame)
    await ready
    const win = this.win = frame.contentWindow as RuntimeWindow
    const doc = frame.contentDocument!
    if (!win.crossOriginIsolated) throw new Error('当前 WebView 无法在游戏画面中启用 WASM 多线程')
    const screen = this.screen = doc.querySelector('canvas')!
    win.addEventListener('error', this.coreError)
    const pad: Gamepad = {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true,
      mapping: 'standard', timestamp: 0, buttons: this.buttons, axes: this.axes,
      vibrationActuator: null as unknown as GamepadHapticActuator,
    }
    win.navigator.getGamepads = () => [pad]
    this.trackAudio(win)

    const gamePath = `/game-${game.hash.slice(0, 16)}.${romExtension('psp', game.fileName)}`
    await new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => {
        startup.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve()
      }
      const abort = () => done(startup.reason instanceof DOMException && startup.reason.name === 'TimeoutError' ? new Error('PPSSPP 启动超时') : startup.reason)
      startup.addEventListener('abort', abort, { once: true })
      const script = doc.createElement('script')
      script.src = new URL(runtimeUrl, location.href).href
      script.onerror = () => done(new Error('PPSSPP 核心脚本加载失败'))
      const resources: Record<string, string> = { 'PPSSPPSDL.wasm': wasmUrl, 'PPSSPPSDL.data': assetsUrl }
      win.Module = {
        canvas: screen,
        arguments: ['--xres', '480', '--yres', '272', gamePath],
        locateFile: (name: string, prefix: string) => resources[name] ? new URL(resources[name], location.href).href : prefix + name,
        preRun: [() => {
          try {
            const fs = win.FS
            win.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = '#canvas'
            fs.mkdirTree(systemDirectory)
            fs.mkdirTree(savesDirectory)
            fs.writeFile(`${systemDirectory}/controls.ini`, controls)
            fs.writeFile(`${systemDirectory}/ppsspp.ini`, '[General]\nFirstRun = False\nPauseOnLostFocus = False\nEnableStateUndo = False\n\n[Control]\nShowTouchControls = False\n\n[Log]\nSAVESTATELevel = 5\n')
            for (const entry of savedata) {
              const path = `${savesDirectory}/${entry.path}`
              fs.mkdirTree(path.slice(0, path.lastIndexOf('/')))
              fs.writeFile(path, entry.data)
            }
            fs.writeFile(gamePath, new Uint8Array(buffer), { canOwn: true })
          } catch (error) { done(error); throw error }
        }],
        print: () => {},
        printErr: (line: string) => {
          if (line.includes(`Booted ${gamePath}`)) {
            this.bootCount++
            done()
          }
          if (line.includes('Boot failed:')) {
            const error = new Error('PPSSPP 无法启动此游戏，请检查镜像文件')
            done(error)
            if (this.started) this.onError?.(error)
          }
          const load = this.pendingLoad
          if (load && line.includes(`Done loading '${load.path}'`)) load.result = true
          if (load && /Load state failure|Failed to load.*savestate/i.test(line)) load.result = false
        },
        onAbort: (reason: unknown) => {
          const error = new Error(`PPSSPP 核心停止运行${reason ? '：' + String(reason) : ''}`)
          done(error)
          if (this.started) this.onError?.(error)
        },
      }
      doc.head.append(script)
    })
    startup.throwIfAborted()
    this.started = true
    this.running = true
    // Keep SDL's scheduler alive. Stopping it during a save can shut down
    // Emscripten's runtime before the next resume.
    win.MainLoop.preMainLoop.push(() => this.running || this.stateActive)
    win.MainLoop.postMainLoop.push(() => { this.renderedFrames++; this.copySaveFrame?.() })
    window.addEventListener('pointerdown', this.applyAudio, true)
    window.addEventListener('keydown', this.applyAudio, true)
    await this.waitFor(() => this.renderedFrames > 0, startup)
    this.pause()
  }

  private coreError = (event: ErrorEvent) => {
    if (this.started && event.message) this.onError?.(new Error(`PPSSPP 核心停止运行：${event.message}`))
  }

  private trackAudio(win: RuntimeWindow) {
    const Audio = win.AudioContext
    if (!Audio) return
    const contexts = this.audioContexts
    win.AudioContext = class extends Audio {
      constructor(options?: AudioContextOptions) {
        super(options)
        contexts.add(this)
      }
    }
  }

  private applyAudio = () => {
    for (const context of this.audioContexts) {
      if (this.muted && context.state === 'running') void context.suspend().catch(() => {})
      if (this.running && !this.muted && context.state === 'suspended') void context.resume().catch(() => {})
    }
  }

  pause() { this.running = false }

  resume() {
    if (!this.started) return
    this.running = true
    this.applyAudio()
  }

  async reset() {
    await this.stateOperation(async (_fs, signal) => {
      const bootCount = this.bootCount
      this.shortcut(6)
      await this.waitFor(() => this.bootCount > bootCount, signal)
    })
  }

  input(_player: number, action: Action, down: boolean) {
    const button = this.buttons[PADMAP[action]]
    button.pressed = button.touched = down
    button.value = Number(down)
  }

  analog(x: number, y: number) { this.axes[0] = x; this.axes[1] = y }

  private shortcut(key: 2 | 4 | 6) {
    const win = this.win, screen = this.screen
    if (!win || !screen) return
    for (const type of ['keydown', 'keyup']) {
      screen.dispatchEvent(new win.KeyboardEvent(type, {
        key: 'F' + key, code: 'F' + key, keyCode: 111 + key, which: 111 + key, bubbles: true,
      } as KeyboardEventInit))
    }
  }

  setMuted(muted: boolean) { this.muted = muted; this.applyAudio() }

  setSmoothing(smoothing: boolean) {
    if (this.screen) this.screen.style.imageRendering = smoothing ? 'auto' : 'pixelated'
  }

  private async waitFor(condition: () => boolean, signal: AbortSignal) {
    do {
      signal.throwIfAborted()
      if (condition()) return
      await new Promise(resolve => setTimeout(resolve, 25))
    } while (true)
  }

  private async stateOperation<T>(run: (fs: FileSystem, signal: AbortSignal) => Promise<T>) {
    if (!this.win || !this.started) throw new Error('请先启动游戏')
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(12_000)])
    try {
      this.stateActive = true
      return await run(this.win.FS, signal)
    } catch (error) {
      if (signal.aborted && !this.lifetime.signal.aborted) throw new Error('PPSSPP 操作超时')
      throw error
    } finally {
      this.stateActive = false
    }
  }

  async save(onPreview?: (preview: Blob) => void) {
    return this.stateOperation(async (fs, signal) => {
      fs.mkdirTree(statesDirectory)
      for (const entry of fs.readdir(statesDirectory)) {
        if (slotFile.test(entry) || /_0\.jpg$/i.test(entry)) fs.unlink(`${statesDirectory}/${entry}`)
      }
      let canvas: HTMLCanvasElement | undefined
      this.copySaveFrame = onPreview ? () => {
        this.copySaveFrame = undefined
        const screen = this.screen
        if (!screen?.width || !screen.height) return
        try {
          const copy = document.createElement('canvas')
          copy.width = screen.width
          copy.height = screen.height
          const context = copy.getContext('2d')
          if (!context) return
          context.drawImage(screen, 0, 0)
          if (context.getImageData(copy.width >> 1, copy.height >> 1, 1, 1).data[3]) canvas = copy
        } catch { /* The core's own thumbnail can still be used. */ }
      } : undefined
      try {
        this.shortcut(2)
        let name: string | undefined
        await this.waitFor(() => !!(name = fs.readdir(statesDirectory).find(entry => slotFile.test(entry))), signal)
        const file = fs.readFile(`${statesDirectory}/${name!}`)
        const header = new TextEncoder().encode(name! + '\0')
        const state = new Uint8Array(header.length + file.length)
        state.set(header); state.set(file, header.length)
        if (onPreview) {
          try {
            const path = `${statesDirectory}/${name!.replace(/\.ppst$/, '.jpg')}`
            const preview = fs.analyzePath(path).exists && fs.readFile(path)
            if (preview && preview.length) {
              onPreview(new Blob([new Uint8Array(preview)], { type: 'image/jpeg' }))
            } else if (canvas) {
              const image = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve))
              if (image?.size) onPreview(image)
            }
          } catch (error) { console.warn('[PPSSPP] 读取存档截图失败', error) }
        }
        return state
      } finally { this.copySaveFrame = undefined }
    })
  }

  async restore(data: Uint8Array) {
    const split = data.subarray(0, 1024).indexOf(0)
    const name = new TextDecoder().decode(data.subarray(0, split))
    if (split < 1 || split === data.length - 1 || !slotFile.test(name)) throw new Error('PPSSPP 存档格式无效')
    await this.stateOperation(async (fs, signal) => {
      fs.mkdirTree(statesDirectory)
      const path = `${statesDirectory}/${name}`
      fs.writeFile(path, data.subarray(split + 1))
      const load: NonNullable<PspRunner['pendingLoad']> = { path }
      this.pendingLoad = load
      try {
        this.shortcut(4)
        await this.waitFor(() => load.result !== undefined, signal)
        if (!load.result) throw new Error('PPSSPP 无法读取此存档')
      } finally { this.pendingLoad = undefined }
    })
  }

  flush() {
    if (!this.win || !this.started) return this.flushing
    const fs = this.win.FS
    const readDirectory = (directory: string): { path: string; modified: number; size: number }[] => {
      if (!fs.analyzePath(directory).exists) return []
      return fs.readdir(directory).sort().filter(name => name !== '.' && name !== '..').flatMap(name => {
        const path = `${directory}/${name}`, stat = fs.stat(path)
        return fs.isDir(stat.mode) ? readDirectory(path) : [{ path, modified: stat.mtime.getTime(), size: stat.size }]
      })
    }
    const result = this.flushing.then(async () => {
      const files = readDirectory(savesDirectory)
      const signature = JSON.stringify(files)
      if (signature === this.saveSignature) return
      const savedata: PspSaveFile[] = files.map(({ path }) => ({ path: path.slice(savesDirectory.length + 1), data: new Uint8Array(fs.readFile(path)) }))
      await putPspSavedata(savedata)
      this.saveSignature = signature
    })
    this.flushing = result.catch(() => {})
    return result
  }

  dispose() {
    if (!this.frame) return this.cleanup
    const frame = this.frame
    this.frame = undefined
    this.lifetime.abort()
    this.pause()
    window.removeEventListener('pointerdown', this.applyAudio, true)
    window.removeEventListener('keydown', this.applyAudio, true)
    this.win?.removeEventListener('error', this.coreError)
    const persisted = this.flush()
    this.started = false
    this.win = undefined
    this.screen = undefined
    this.cleanup = persisted.finally(() => {
      for (const context of this.audioContexts) void context.close().catch(() => {})
      this.audioContexts.clear()
      frame.remove()
    })
    return this.cleanup
  }
}
