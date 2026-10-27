// 运行环境与浏览器平台工具。
// 仅依据运行时全局对象判断,SSR 或无 navigator/document 时全部安全返回。

function ua(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
}

/** 是否 Android 设备(手机/平板/TV 皆算)。 */
export const isAndroid = /android/i.test(ua())

/** 是否运行在 Tauri WebView 中。 */
export const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

export type PickedRomFile = {
  name: string
  bytes: Uint8Array
}

/** 让用户选择一个 .nes ROM 文件,返回其字节。 */
export function pickRomFile(): Promise<PickedRomFile | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.nes'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const buf = await file.arrayBuffer()
      resolve({ name: file.name, bytes: new Uint8Array(buf) })
    }
    input.click()
  })
}

export function setLastRomName(name: string, key: string): void {
  try {
    localStorage.setItem(key, name)
  } catch {
    /* ignore storage failures */
  }
}
