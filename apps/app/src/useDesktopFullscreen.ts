import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'

// Child WebViews share the main native window; DOM fullscreen cannot resize it.
export function provideDesktopFullscreen() {
  if (!isTauri() || !__TAURI_DESKTOP__) return

  const window = getCurrentWindow()
  const isFullscreen = ref(false)
  let disposed = false
  let unlisten: UnlistenFn | undefined

  async function sync() {
    const value = await window.isFullscreen()
    if (!disposed) isFullscreen.value = value
  }

  async function setFullscreen(value: boolean) {
    try {
      await window.setFullscreen(value)
      await sync()
    } catch (error) {
      console.warn('无法切换窗口全屏', error)
    }
  }

  provide('playerFullscreen', {
    isFullscreen,
    usePseudo: ref(false),
    enter: () => setFullscreen(true),
    exit: () => setFullscreen(false),
    toggle: async () => {
      try {
        await setFullscreen(!await window.isFullscreen())
      } catch (error) {
        console.warn('无法读取窗口全屏状态', error)
      }
    },
  })

  onMounted(async () => {
    try {
      const off = await window.onResized(() => { void sync().catch(console.warn) })
      if (disposed) off()
      else {
        unlisten = off
        await sync()
      }
    } catch (error) {
      console.warn('无法同步窗口全屏状态', error)
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })
}
