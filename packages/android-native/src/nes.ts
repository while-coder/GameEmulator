import { Button, type NesRunnerApi, type SaveState } from '@game-emulator/nes'
import { httpNativeTransport, type NativeTransport } from './transport'

const BUILD = 'fceumm-e0f3086-native-v1'
const ARCADE_BUILD = 'fbalpha2012-0ce3153-native-v1'
const buttons: Partial<Record<Button, [number, number]>> = {
  [Button.Joypad1A]: [0, 8], [Button.Joypad1B]: [0, 0],
  [Button.Joypad1Up]: [0, 4], [Button.Joypad1Down]: [0, 5],
  [Button.Joypad1Left]: [0, 6], [Button.Joypad1Right]: [0, 7],
  [Button.Joypad1Start]: [0, 3], [Button.Joypad1Select]: [0, 2],
  [Button.Joypad2A]: [1, 8], [Button.Joypad2B]: [1, 0],
  [Button.Joypad2Up]: [1, 4], [Button.Joypad2Down]: [1, 5],
  [Button.Joypad2Left]: [1, 6], [Button.Joypad2Right]: [1, 7],
  [Button.Joypad2Start]: [1, 3], [Button.Joypad2Select]: [1, 2],
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map(value => value.toString(16).padStart(2, '0')).join('')
}

/** TV-only transport. No emulation, video frames or audio are scheduled in JS. */
export class NativeSession {
  readonly nativeInput = true
  readonly saveNamespace: string
  onError?: (error: Error) => void
  private ready = false
  private running = false
  private hash = ''
  private nativeAspect = 4 / 3
  private volume = 1
  private enabled = true
  private masks = [0, 0]
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false
  private polling = 0
  private debug = false
  private readonly output = document.createElement('output')
  private readonly observer: ResizeObserver
  private readonly nativePause = () => { this.running = false; this.onError?.(new Error('游戏已暂停')) }
  constructor(private readonly canvas: HTMLCanvasElement, private readonly transport: NativeTransport = httpNativeTransport,
              private readonly system: 'nes' | 'arcade' = 'nes') {
    this.saveNamespace = system === 'arcade' ? ARCADE_BUILD : BUILD
    this.output.style.cssText = 'position:absolute;top:4px;left:4px;z-index:3;background:#000b;color:white;padding:4px;font:12px monospace;pointer-events:none;display:none'
    canvas.parentElement?.append(this.output)
    this.observer = new ResizeObserver(() => this.syncDisplay())
    this.observer.observe(canvas)
    window.addEventListener('tv-native-pause', this.nativePause)
    this.send('stop')
  }
  get loaded() { return this.ready }
  get isRunning() { return this.running }
  get aspectRatio() { return this.nativeAspect }
  private async request(path: string, method = 'GET', body?: BodyInit): Promise<Response> {
    const response = await this.transport(`/native/${this.system}/${path}`, method, body)
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `原生模拟器请求失败 (${response.status})`)
    }
    return response
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action)
    this.tail = result.catch(() => {})
    return result
  }
  private command(action: string, options: Record<string, unknown> = {}) {
    return this.request('command', 'POST', JSON.stringify({ action, ...options }))
  }
  private send(action: string, options: Record<string, unknown> = {}) {
    if (this.disposed) return
    void this.enqueue(() => this.command(action, options)).catch(error => this.onError?.(error))
  }
  async loadRom(bytes: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed) throw new Error('游戏页面已关闭')
      this.ready = false; this.running = false
      const info = await (await this.request('info')).json()
      if (info.build !== this.saveNamespace) throw new Error('原生内核与页面版本不匹配，请重新启动应用')
      const result = await (await this.request('load', 'POST', new Blob([bytes as BlobPart]))).json()
      this.hash = result.hash; this.masks = [0, 0]; this.ready = true
      await this.command('volume', { value: this.enabled ? this.volume : 0 })
    })
    this.syncDisplay()
    this.startPolling()
    // PlayerShell resumes after loading and applies its current modal/pause state.
  }
  async loadArcade(game: { name: string; hash: string; file: Blob }, dependencies: { name: string; hash: string; file: Blob }[]) {
    await this.enqueue(async () => {
      if (this.disposed) throw new Error('游戏页面已关闭')
      this.ready = false; this.running = false
      const info = await (await this.request('info')).json()
      if (info.build !== this.saveNamespace) throw new Error('原生内核与页面版本不匹配')
      const files = [game, ...dependencies]
      await this.request('prepare', 'POST', JSON.stringify({ game: game.name, files: files.map(file => ({ name: file.name, size: file.file.size, hash: file.hash })) }))
      for (const file of files) for (let offset = 0; offset < file.file.size; offset += 256 * 1024) {
        if (this.disposed) throw new Error('已取消游戏加载')
        await this.request(`upload/${file.name}/${offset}`, 'POST', file.file.slice(offset, offset + 256 * 1024))
      }
      if (this.disposed) throw new Error('已取消游戏加载')
      const result = await (await this.request('load', 'POST')).json()
      this.hash = await sha256(new TextEncoder().encode(files.map(file => `${file.name}=${file.hash}`).sort().join('\n')))
      this.nativeAspect = Number(result.aspect) || 4 / 3
      this.masks = [0, 0]; this.ready = true
      await this.command('volume', { value: this.enabled ? this.volume : 0 })
    })
    this.syncDisplay(); this.startPolling()
  }
  pause(): void {
    this.running = false; this.masks = [0, 0]
    if (!this.ready || this.disposed) return
    void this.enqueue(async () => {
      // One still frame on pause keeps the existing page's paused background.
      // It is intentionally not a per-frame transport.
      try {
        const blob = await (await this.request('frame')).blob()
        if (blob.size) {
          const image = await createImageBitmap(blob)
          this.canvas.width = image.width; this.canvas.height = image.height
          this.canvas.getContext('2d')?.drawImage(image, 0, 0); image.close()
        }
      } catch { /* A missing/destroyed surface must never prevent pausing. */ }
      await this.command('pause')
    }).catch(error => this.onError?.(error))
  }
  resume(): void {
    if (!this.ready || this.disposed) return
    this.running = true; this.syncDisplay(); this.send('resume')
  }
  unload(): void {
    this.ready = false; this.running = false; clearInterval(this.polling)
    this.send('stop')
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.ready = false; this.running = false
    clearInterval(this.polling); this.observer.disconnect(); this.output.remove()
    window.removeEventListener('tv-native-pause', this.nativePause)
    await this.enqueue(() => this.command('stop'))
  }
  reset(): void { this.send('reset') }
  resumeAudio(): void {}
  setVolume(value: number): void { this.volume = Math.max(0, Math.min(1, value)); this.setAudioEnabled(this.enabled) }
  setAudioEnabled(value: boolean): void { this.enabled = value; this.send('volume', { value: value ? this.volume : 0 }) }
  setSpeed(value: number): void { this.send('speed', { value }) }
  configureInput(maps: Record<number, string>[], turboHz: number): void {
    this.send('configure', { maps: structuredClone(maps.map(map => ({ ...map }))), turboHz })
  }
  pressRetro(player: number, bit: number, down: boolean): void {
    if (player < 0 || player > 1 || !this.ready || !this.running) return
    this.masks[player] = down ? this.masks[player] | (1 << bit) : this.masks[player] & ~(1 << bit)
    this.send('input', { player, mask: this.masks[player] })
  }
  syncDisplay(smoothing?: boolean, scanlines?: boolean): void {
    if (this.disposed) return
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) this.send('bounds', {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
    })
    if (smoothing !== undefined) this.send('smoothing', { value: Number(smoothing) })
    if (scanlines !== undefined) this.send('scanlines', { value: Number(scanlines) })
  }
  setDebug(enabled: boolean): void { this.debug = enabled; this.output.style.display = enabled ? '' : 'none'; this.send('debug', { value: Number(enabled) }) }
  private startPolling() {
    clearInterval(this.polling)
    this.polling = window.setInterval(() => {
      if (!this.ready || this.disposed) return
      void this.enqueue(async () => {
        const stats = await (await this.request('stats')).json()
        if (stats.failed) { this.running = false; throw new Error(stats.error || '原生模拟器已停止，请重新打开游戏') }
        if (this.debug) this.output.textContent = `Native · ${Number(stats.emulationFps).toFixed(1)} / ${Number(stats.presentationFps).toFixed(1)} FPS · ${Number(stats.runMs).toFixed(1)} ms · late ${stats.lateFrames} · audio ${stats.audioUnderruns}`
      }).catch(error => { clearInterval(this.polling); this.onError?.(error) })
    }, 1000)
  }
  private input(button: Button, down: boolean) {
    const mapping = buttons[button]
    if (!mapping || !this.ready || !this.running) return
    const [player, bit] = mapping
    this.pressRetro(player, bit, down)
  }
  press(button: Button): void {
    if (button === Button.Reset) this.reset()
    else if (button === Button.Poweroff) this.unload()
    else this.input(button, true)
  }
  release(button: Button): void { this.input(button, false) }
  async saveState(): Promise<SaveState | null> {
    return this.enqueue(async () => {
      if (!this.ready) return null
      const data = new Uint8Array(await (await this.request('state')).arrayBuffer())
      const HEADER = new TextEncoder().encode(`GameEmulator:${this.saveNamespace}\n`)
      const metadata = new TextEncoder().encode(JSON.stringify({ rom: this.hash, sha256: await sha256(data) }) + '\n')
      const result = new Uint8Array(HEADER.length + metadata.length + data.length)
      result.set(HEADER); result.set(metadata, HEADER.length); result.set(data, HEADER.length + metadata.length)
      return result
    })
  }
  async loadState(state: SaveState): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.ready) return false
      const HEADER = new TextEncoder().encode(`GameEmulator:${this.saveNamespace}\n`)
      if (!HEADER.every((byte, index) => state[index] === byte)) throw new Error('此存档属于 WASM 或其他内核版本，已保留原存档')
      const end = state.indexOf(10, HEADER.length)
      if (end < 0 || end > HEADER.length + 1024) throw new Error('存档头损坏')
      const metadata = JSON.parse(new TextDecoder().decode(state.subarray(HEADER.length, end)))
      const data = state.subarray(end + 1)
      if (metadata.rom !== this.hash || metadata.sha256 !== await sha256(data)) throw new Error('存档与游戏不匹配或校验失败')
      await this.request('restore', 'POST', new Blob([data as BlobPart]))
      this.masks = [0, 0]; return true
    })
  }
}
export class NativeNesRunner extends NativeSession implements NesRunnerApi {}
