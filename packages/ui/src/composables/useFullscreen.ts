import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// ===== 全屏:整个应用铺满,兼顾原生 Fullscreen API 与 CSS 伪全屏回退 =====
// 目标元素通常是 App 根容器(工具栏+画面+footer),这样任何状态下 UI 都可操作、可退出。
//
// - 桌面 / Android Chrome:走原生 Fullscreen API(含 Safari 的 webkit 前缀)。
// - iOS Safari:对非 <video> 元素不提供 requestFullscreen,自动回退到 CSS 伪全屏
//   (调用方据 usePseudo 给元素加 position:fixed 铺满视口的 class)。
//   注:iOS 只有"添加到主屏"的 PWA(standalone)才能真正隐藏地址栏,普通标签页做不到。

// webkit 前缀方法在 lib.dom 里未声明,用结构化类型绕过(Safari 实际支持)。
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}
type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

export interface FullscreenApi {
  /** 当前是否全屏(原生或伪全屏统一) */
  isFullscreen: Ref<boolean>
  /** 该环境是否走 CSS 伪全屏(= 无原生 requestFullscreen) */
  usePseudo: Ref<boolean>
  toggle: () => Promise<void>
  enter: () => Promise<void>
  exit: () => Promise<void>
}

export function useFullscreen(target: Ref<HTMLElement | null>): FullscreenApi {
  const isFullscreen = ref(false)
  // 原生 API 是否可用:SSR 期先假定可用,onMounted 时按目标元素探测修正。
  const usePseudo = ref(false)

  function nativeFullscreenElement(): Element | null {
    if (typeof document === 'undefined') return null
    const doc = document as WebkitDocument
    return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
  }

  function supportsNative(el: HTMLElement): boolean {
    return typeof (el as WebkitElement).webkitRequestFullscreen === 'function' ||
      typeof el.requestFullscreen === 'function'
  }

  async function enter(): Promise<void> {
    const el = target.value
    if (!el || isFullscreen.value) return
    if (usePseudo.value) {
      // 伪全屏:状态置真,DOM 铺满由调用方绑定的 class 负责;挂 Esc 兜底退出。
      isFullscreen.value = true
      window.addEventListener('keydown', onPseudoKey)
      return
    }
    try {
      const wk = el as WebkitElement
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen()
      else await wk.webkitRequestFullscreen?.()
      // isFullscreen 由 fullscreenchange 事件同步,无需在此置真。
    } catch (err) {
      console.warn('[NES] 进入全屏失败', err)
    }
  }

  async function exit(): Promise<void> {
    if (!isFullscreen.value) return
    if (usePseudo.value) {
      isFullscreen.value = false
      window.removeEventListener('keydown', onPseudoKey)
      return
    }
    try {
      const doc = document as WebkitDocument
      if (typeof document.exitFullscreen === 'function') await document.exitFullscreen()
      else await doc.webkitExitFullscreen?.()
    } catch (err) {
      console.warn('[NES] 退出全屏失败', err)
    }
  }

  async function toggle(): Promise<void> {
    if (isFullscreen.value) await exit()
    else await enter()
  }

  // 原生全屏状态变化(含用户按浏览器 Esc / F11 退出)→ 同步 isFullscreen。
  function onNativeChange(): void {
    if (usePseudo.value) return
    isFullscreen.value = nativeFullscreenElement() === target.value
  }

  // 伪全屏下的 Esc 兜底(桌面;iOS 一般无键盘)。
  function onPseudoKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      void exit()
    }
  }

  onMounted(() => {
    // 目标元素挂载后才能准确探测:无原生 API 则回退伪全屏。
    if (target.value) usePseudo.value = !supportsNative(target.value)
    document.addEventListener('fullscreenchange', onNativeChange)
    document.addEventListener('webkitfullscreenchange', onNativeChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onNativeChange)
    document.removeEventListener('webkitfullscreenchange', onNativeChange)
    window.removeEventListener('keydown', onPseudoKey)
    // 卸载时若仍处于原生全屏,退出以免残留。
    if (!usePseudo.value && nativeFullscreenElement()) void exit()
  })

  return { isFullscreen, usePseudo, toggle, enter, exit }
}
