import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createHoldAction } from './holdAction'
import { useRemoteNav } from './useRemoteNav'

export function useCardActionMenu(disabled: () => boolean, activate: () => void) {
  const trigger = ref<HTMLButtonElement | null>(null)
  const dialog = ref<HTMLDialogElement | null>(null)
  const shown = ref(false)
  const position = ref<Record<string, string>>({})
  let origin: { x: number; y: number } | null = null
  let keyboardPress = false
  let suppressClick = false
  let disposed = false

  function cancelPress() { hold.cancel(); keyboardPress = false; origin = null }
  function cancelPointer() { if (origin) suppressClick = true; cancelPress() }
  async function openMenu(point?: { x: number; y: number }) {
    if (disabled() || shown.value) return
    suppressClick = true
    position.value = {}
    shown.value = true
    await nextTick()
    if (disposed || !shown.value) return
    dialog.value?.showModal()
    if (point && dialog.value) {
      const rect = dialog.value.getBoundingClientRect()
      position.value = {
        margin: '0',
        left: `${Math.max(8, Math.min(point.x, innerWidth - rect.width - 8))}px`,
        top: `${Math.max(8, Math.min(point.y, innerHeight - rect.height - 8))}px`,
      }
    }
  }
  const hold = createHoldAction(() => { void openMenu() })
  function contextMenu(event: MouseEvent) {
    const mouse = event.button === 2 || (event instanceof PointerEvent && event.pointerType === 'mouse')
    void openMenu(mouse ? { x: event.clientX, y: event.clientY } : undefined)
  }
  function closeMenu() { shown.value = false; dialog.value?.close() }
  async function closed() {
    if (dialog.value?.open) return
    shown.value = false
    cancelPress()
    await nextTick()
    if (!disposed && !shown.value && document.activeElement === document.body && trigger.value?.isConnected && !disabled()) {
      trigger.value.focus({ preventScroll: true })
    }
  }
  function pointerDown(event: PointerEvent) {
    if (disabled() || event.button !== 0 || !event.isPrimary) return
    suppressClick = false
    origin = { x: event.clientX, y: event.clientY }
    hold.start()
  }
  function pointerMove(event: PointerEvent) {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      suppressClick = true
      cancelPress()
    }
  }
  function click(event: MouseEvent) {
    if (shown.value || (event.detail > 0 && (suppressClick || hold.held))) { event.preventDefault(); return }
    if (!disabled()) activate()
  }
  function isConfirm(event: KeyboardEvent) {
    return ['Enter', 'NumpadEnter', 'Select', 'Accept', ' '].includes(event.key) || event.keyCode === 23
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault(); cancelPress(); void openMenu(); return
    }
    if (event.key === 'ContextMenu' || event.key === 'Menu' || event.keyCode === 82) {
      event.preventDefault(); event.stopPropagation(); cancelPress(); void openMenu()
    } else if (isConfirm(event)) {
      event.preventDefault(); event.stopPropagation()
      if (!event.repeat && !keyboardPress && !disabled()) {
        keyboardPress = true; suppressClick = false; hold.start()
      }
    } else cancelPress()
  }
  function keyUp(event: KeyboardEvent) {
    if (!isConfirm(event)) return
    event.preventDefault(); event.stopPropagation()
    const short = hold.release()
    keyboardPress = false
    if (short && !disabled() && !shown.value) activate()
  }
  function padDown() {
    if (disabled()) return
    keyboardPress = true; suppressClick = false; hold.start()
  }
  function padUp() {
    const short = hold.release()
    keyboardPress = false
    if (short && !disabled() && !shown.value) activate()
  }
  watch(disabled, disabled => { if (disabled) { cancelPress(); closeMenu() } })
  onBeforeUnmount(() => { disposed = true; cancelPress(); dialog.value?.close() })
  useRemoteNav({ container: dialog, active: computed(() => shown.value), autoFocus: true, priority: 25, onBack: closeMenu })

  return { trigger, dialog, shown, position, contextMenu, closeMenu, closed, click,
    pointerDown, pointerMove, pointerUp: () => { hold.release(); origin = null },
    cancelPointer, cancelPress, keyDown, keyUp, padDown, padUp }
}
