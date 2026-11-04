import './interaction.css'

let installed = false

/** Keep browser gestures from interrupting the launcher and multi-touch controls. */
export function configureWebInteractions() {
  if (installed) return
  installed = true

  let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!viewport) {
    viewport = document.createElement('meta')
    viewport.name = 'viewport'
    document.head.append(viewport)
  }
  viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'

  const preventDefault = (event: Event) => {
    if (event.cancelable) event.preventDefault()
  }
  // WebKit exposes pinch gestures separately from touch/pointer events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, preventDefault, { passive: false })
  }
  // Trackpad pinch is delivered as Ctrl+wheel in Chromium WebViews.
  document.addEventListener('wheel', event => {
    if (event.ctrlKey) preventDefault(event)
  }, { passive: false })

  const preventOutsideEditor = (event: Event) => {
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
    preventDefault(event)
  }
  document.addEventListener('contextmenu', preventDefault)
  document.addEventListener('selectstart', preventOutsideEditor)
  document.addEventListener('dragstart', preventOutsideEditor)
}
