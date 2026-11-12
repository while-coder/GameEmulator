export type NativeTransport = (path: string, method: string, body?: BodyInit) => Promise<Response>

export const httpNativeTransport: NativeTransport = async (path, method, body) => fetch(path, {
  method, body, headers: { 'X-GameEmulator-TV': '1' }, signal: AbortSignal.timeout(path.endsWith('/load') ? 120000 : 30000),
})

type Reply = { id: number; error?: string; body: string; mime: string }
type WebMessageBridge = { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null }
function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
function decode(value: string): Uint8Array {
  const binary = atob(value), bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Origin-scoped WebMessage transport for the ordinary Android APK. */
export function createWebViewTransport(): NativeTransport {
  let sequence = 0
  const pending = new Map<number, { resolve: (value: Response) => void; reject: (error: Error) => void; timer: number }>()
  let attached: WebMessageBridge | undefined
  return async (path, method, body) => {
    const bridge = (window as Window & { GameEmulatorNative?: WebMessageBridge }).GameEmulatorNative
    if (!bridge) throw new Error('原生模拟器通道未加载，请更新 Android System WebView 并重新启动应用')
    if (attached !== bridge) {
      attached = bridge
      bridge.onmessage = event => {
        const reply = JSON.parse(event.data) as Reply, request = pending.get(reply.id)
        if (!request) return
        pending.delete(reply.id); clearTimeout(request.timer)
        if (reply.error) request.reject(new Error(reply.error))
        else request.resolve(new Response(decode(reply.body) as BodyInit, { headers: { 'Content-Type': reply.mime } }))
      }
    }
    const bytes = body === undefined ? new Uint8Array() : new Uint8Array(await new Response(body).arrayBuffer())
    const id = ++sequence
    return new Promise<Response>((resolve, reject) => {
      const timer = window.setTimeout(() => { pending.delete(id); reject(new Error('原生模拟器操作超时')) }, path.endsWith('/load') ? 120000 : 30000)
      pending.set(id, { resolve, reject, timer })
      try { bridge.postMessage(JSON.stringify({ id, path, method, body: encode(bytes) })) }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
    })
  }
}
