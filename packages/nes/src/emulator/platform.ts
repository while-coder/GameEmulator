// 运行环境检测，兼容无 navigator 或 window 的环境。

function ua(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
}

/** 是否 Android 设备(手机/平板/TV 皆算)。 */
export const isAndroid = /android/i.test(ua())

/** 是否运行在 Tauri WebView 中。 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
