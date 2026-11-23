type StateReader = { loadState(state: Blob): Promise<void> }
type LoadConfirmation = { resolve: () => void; reject: (reason: unknown) => void }

export const retroArchStateLogging = { log_verbosity: true, frontend_log_level: 1 } as const

export class RetroArchStateLoader {
  private pending?: LoadConfirmation

  readLog = (message: string) => {
    const pending = this.pending
    if (!pending) return
    if (/\[State\].*Failed to load state/i.test(message)) {
      pending.reject(new Error('内核无法读取此存档，存档可能已损坏或不兼容'))
    } else if (/\[State\].*Loading state ".*", \d+ bytes\./i.test(message)) {
      // RetroArch logs this in the task's completion callback, just before
      // deserializing. It reports any rejection in the same callback.
      queueMicrotask(() => { if (this.pending === pending) pending.resolve() })
    }
  }

  async load(core: StateReader, state: Blob, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (!state.size) throw new Error('存档为空，无法读取')
    if (this.pending) throw new Error('正在读取存档')
    let pending!: LoadConfirmation
    const confirmation = new Promise<void>((resolve, reject) => { pending = { resolve, reject } })
    this.pending = pending
    const abort = () => pending.reject(signal?.reason)
    const timeout = setTimeout(() => pending.reject(new Error('内核未确认存档已读取')), 6000)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      // Nostalgist resolves after scheduling the load command.
      await Promise.all([core.loadState(state), confirmation])
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (this.pending === pending) this.pending = undefined
    }
  }

  cancel() { this.pending?.reject(new DOMException('模拟器已关闭', 'AbortError')) }
}
