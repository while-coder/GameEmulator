/** One press produces either a short action or a long action, never both. */
export function createHoldAction(onHold: () => void, delay = 600) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pressed = false
  let held = false
  function cancel() {
    clearTimeout(timer)
    timer = undefined
    pressed = false
  }
  return {
    start() {
      cancel()
      pressed = true
      held = false
      timer = setTimeout(() => {
        if (!pressed) return
        timer = undefined
        held = true
        onHold()
      }, delay)
    },
    cancel,
    release() {
      const short = pressed && !held
      cancel()
      return short
    },
    get held() { return held },
  }
}
