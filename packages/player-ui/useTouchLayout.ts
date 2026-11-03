import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type CSSProperties } from 'vue'
import type { TouchControlLayout } from './touchLayout'

export function useTouchLayout<K extends string>(
  settings: { touchLayout: Record<'portrait' | 'landscape', Partial<Record<K, TouchControlLayout>>> },
  props: { editing?: boolean },
  controls: { id: K; label: string }[],
  releaseAll: () => void,
) {
  const controlsRef = ref<HTMLElement | null>(null)
  const orientation = ref<'portrait' | 'landscape'>('landscape')
  const layout = computed(() => settings.touchLayout[orientation.value])
  const selected = ref<string>('dpad')
  const selectedLayout = computed(() => layout.value[selected.value as K])
  const sizes = reactive<Record<string, { width: number; height: number }>>({})
  const detached = computed(() => controls.some(control => control.id !== 'dpad' && layout.value[control.id]))
  let observer: ResizeObserver | undefined
  let drag: { id: number; key: K; element: HTMLElement; dx: number; dy: number } | undefined

  function measure() {
    orientation.value = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
    for (const element of controlsRef.value?.querySelectorAll<HTMLElement>('[data-layout-group]') ?? []) {
      sizes[element.dataset.layoutGroup!] = { width: element.offsetWidth, height: element.offsetHeight }
    }
  }
  function center(element: HTMLElement) {
    const bounds = controlsRef.value!.getBoundingClientRect(), rect = element.getBoundingClientRect()
    return { x: (rect.left + rect.width / 2 - bounds.left) / bounds.width, y: (rect.top + rect.height / 2 - bounds.top) / bounds.height }
  }
  // Capture all default button centers together before detaching them from their row/column layout.
  async function initializeButtons() {
    if (!props.editing) return
    await nextTick()
    const root = controlsRef.value
    if (!root || !root.clientWidth || !root.clientHeight) return
    const positions: [K, TouchControlLayout][] = []
    for (const element of root.querySelectorAll<HTMLElement>('[data-layout-button]')) {
      const key = element.dataset.layoutGroup as K
      if (!layout.value[key]) positions.push([key, center(element)])
    }
    for (const [key, position] of positions) layout.value[key] = position
  }
  function positionStyle(key: K): CSSProperties {
    const position = layout.value[key], size = sizes[key]
    const scalable = controls.some(control => control.id === key)
    const base = key === 'dpad' ? '--pad-size' : '--action-size'
    const dimension = `max(${key === 'dpad' ? 96 : 44}px, calc(var(${base}) * ${position?.scale ?? 1}))`
    return {
      ...(props.editing && selected.value === key ? { outline: '3px solid #fff' } : {}),
      ...(scalable ? { width: dimension, height: dimension } : {}),
      ...(position && size ? {
        position: 'absolute', gridArea: 'auto', placeSelf: 'auto', margin: '0',
        left: `clamp(${size.width / 2}px, ${position.x * 100}%, calc(100% - ${size.width / 2}px))`,
        top: `clamp(${size.height / 2}px, ${position.y * 100}%, calc(100% - ${size.height / 2}px))`,
        right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)',
      } : {}),
      ...(position?.hidden ? props.editing ? { opacity: '0.3' } : { visibility: 'hidden', pointerEvents: 'none' } : {}),
    }
  }
  function endLayoutDrag(event?: PointerEvent) {
    if (!drag || event && event.pointerId !== drag.id) return
    const previous = drag
    drag = undefined
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id)
  }
  function startLayoutDrag(event: PointerEvent) {
    if (!props.editing || event.button !== 0 || (event.target as HTMLElement).closest('[data-layout-editor]')) return
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-group]')
    if (!element || drag) return
    event.preventDefault(); event.stopPropagation(); releaseAll()
    const key = element.dataset.layoutGroup as K, rect = element.getBoundingClientRect()
    if (controls.some(control => control.id === key)) selected.value = key
    drag = { id: event.pointerId, key, element, dx: event.clientX - rect.left - rect.width / 2, dy: event.clientY - rect.top - rect.height / 2 }
    element.setPointerCapture(event.pointerId)
  }
  function moveLayoutDrag(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    const bounds = controlsRef.value!.getBoundingClientRect(), rect = drag.element.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const x = Math.max(rect.width / 2, Math.min(bounds.width - rect.width / 2, event.clientX - bounds.left - drag.dx))
    const y = Math.max(rect.height / 2, Math.min(bounds.height - rect.height / 2, event.clientY - bounds.top - drag.dy))
    layout.value[drag.key] = { ...layout.value[drag.key], x: x / bounds.width, y: y / bounds.height }
  }
  function updateSelected(change: Partial<TouchControlLayout>) {
    const key = selected.value as K
    const element = controlsRef.value?.querySelector<HTMLElement>(`[data-layout-group="${key}"]`)
    if (!element) return
    layout.value[key] = { ...center(element), ...layout.value[key], ...change }
  }
  function resizeSelected(scale: number) { updateSelected({ scale }) }
  function toggleSelected() { updateSelected({ hidden: !selectedLayout.value?.hidden }) }
  function suppressEditClick(event: MouseEvent) {
    if (props.editing && !(event.target as HTMLElement).closest('[data-layout-editor]')) { event.preventDefault(); event.stopPropagation() }
  }
  function onResize() { endLayoutDrag(); measure() }
  watch(() => props.editing, () => { endLayoutDrag(); releaseAll(); void initializeButtons() })
  watch([orientation, layout], () => { endLayoutDrag(); void initializeButtons() })
  onMounted(() => {
    measure(); void initializeButtons()
    observer = new ResizeObserver(measure)
    if (controlsRef.value) {
      observer.observe(controlsRef.value)
      for (const element of controlsRef.value.querySelectorAll('[data-layout-group]')) observer.observe(element)
    }
    window.addEventListener('resize', onResize)
  })
  onBeforeUnmount(() => { endLayoutDrag(); observer?.disconnect(); window.removeEventListener('resize', onResize) })
  return { controlsRef, detached, selected, selectedLayout, positionStyle, startLayoutDrag, moveLayoutDrag, endLayoutDrag, suppressEditClick, resizeSelected, toggleSelected }
}
