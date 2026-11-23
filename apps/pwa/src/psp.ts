import { startConsole } from './console'

async function start() {
  const url = new URL(location.href)
  const worker = navigator.serviceWorker
  if (import.meta.env.PROD && !crossOriginIsolated && worker && !url.searchParams.has('psp-isolation')) {
    try {
      await worker.register(new URL('sw.js', url), { updateViaCache: 'none' })
      if (!worker.controller) {
        await new Promise<void>(resolve => {
          const signal = AbortSignal.timeout(6000)
          signal.addEventListener('abort', () => resolve(), { once: true })
          worker.addEventListener('controllerchange', () => resolve(), { once: true, signal })
        })
      }
      if (worker.controller) {
        url.searchParams.set('psp-isolation', '1')
        location.replace(url)
        return
      }
    } catch { /* The player reports missing WASM thread support if necessary. */ }
  }
  startConsole('psp')
}
void start()
