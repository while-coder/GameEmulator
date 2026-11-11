export type NavigationDirection = 'up' | 'down' | 'left' | 'right'

const idleTextInputs = new WeakSet<HTMLElement>()

export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && ['text', 'search', 'number', 'password', 'email', 'url', 'tel'].includes(el.type)
}

export function isTextNavigationIdle(el: Element | null): boolean {
  return el instanceof HTMLElement && idleTextInputs.has(el)
}

/** Keep the input as a navigation anchor after the keyboard is dismissed. */
export function finishTextEditing(): boolean {
  const el = document.activeElement
  if (!isTextEntry(el) || idleTextInputs.has(el)) return false
  idleTextInputs.add(el)
  return true
}

export function resumeTextEditing(el: HTMLElement): void {
  if (!idleTextInputs.delete(el)) return
  // Refocus in the OK key's user gesture so Gecko can reopen the soft keyboard.
  el.blur()
  el.focus({ preventScroll: true })
}

if (typeof window !== 'undefined') {
  window.addEventListener('focusout', event => {
    if (event.target instanceof HTMLElement) idleTextInputs.delete(event.target)
  }, true)
  window.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLElement) idleTextInputs.delete(event.target)
  }, true)
}

/** Horizontal navigation stays on the current row, including at its edges. */
export function pickNeighbor(from: DOMRect, candidates: HTMLElement[], dir: NavigationDirection): HTMLElement | null {
  const horizontal = dir === 'left' || dir === 'right'
  const fromCx = from.left + from.width / 2
  const fromCy = from.top + from.height / 2
  let best: HTMLElement | null = null
  let bestCost = Infinity
  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const main = horizontal
      ? (dir === 'left' ? fromCx - cx : cx - fromCx)
      : (dir === 'up' ? fromCy - cy : cy - fromCy)
    if (main <= 1) continue
    const overlap = horizontal
      ? Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top) > 1
      : r.left < from.right && r.right > from.left
    if (horizontal && !overlap) continue
    const off = horizontal ? Math.abs(cy - fromCy) : Math.abs(cx - fromCx)
    const cost = main + off * (overlap ? 0.3 : 0.5)
    if (cost < bestCost) {
      bestCost = cost
      best = el
    }
  }
  return best
}

/** Avoid the browser's initial focus scroll followed by a second corrective scroll. */
export function focusNavigationElement(el: HTMLElement): void {
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}

/** Limit remote auto-repeat without delaying individual taps or direction changes. */
export function createNavigationRepeatGuard() {
  let lastKey = ''
  let lastMove = -Infinity
  return (event: KeyboardEvent, now = performance.now()): boolean => {
    if (event.repeat && event.key === lastKey && now - lastMove < 120) return false
    lastKey = event.key
    lastMove = now
    return true
  }
}
