<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { emulators, type EmulatorId } from './registry'
import '../../player-ui/interaction.css'
import { createNavigationRepeatGuard, focusNavigationElement, pickNeighbor, type NavigationDirection } from '../../player-ui/remoteNavigation'

const props = withDefaults(defineProps<{ launch: (id: EmulatorId) => Promise<void>; active?: boolean }>(), { active: true })
const launching = ref<EmulatorId | null>(null)
const error = ref('')
const cards = ref<HTMLButtonElement[]>([])
let focusedIndex = 0
async function enter(id: EmulatorId) {
  if (launching.value) return
  launching.value = id
  error.value = ''
  try { await props.launch(id) }
  catch (err) { error.value = err instanceof Error ? err.message : String(err) }
  finally { launching.value = null }
}
function focusCard(id?: EmulatorId) {
  const index = id ? emulators.findIndex(emulator => emulator.id === id) : focusedIndex
  const card = cards.value[index]
  if (card && !card.disabled) focusNavigationElement(card)
}
function moveFocus(dir: NavigationDirection) {
  const current = cards.value.find(card => card === document.activeElement)
  if (!current) { focusCard(); return }
  const next = pickNeighbor(current.getBoundingClientRect(), cards.value.filter(card => !card.disabled), dir)
  if (next) focusNavigationElement(next)
}
const allowNavigationRepeat = createNavigationRepeatGuard()
function onKey(event: KeyboardEvent) {
  if (props.active === false || launching.value || event.defaultPrevented) return
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    if (allowNavigationRepeat(event)) moveFocus(event.key.slice(5).toLowerCase() as NavigationDirection)
  }
}
let raf = 0
let pressed = false
let direction: NavigationDirection | null = null
function pollGamepads() {
  const pads = Array.from(navigator.getGamepads?.() ?? [])
  const down = pads.some((pad) => pad?.buttons[0]?.pressed)
  const nextDirection: NavigationDirection | null = pads.some(pad => pad && (pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > .5)) ? 'right'
    : pads.some(pad => pad && (pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -.5)) ? 'left'
    : pads.some(pad => pad && (pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > .5)) ? 'down'
    : pads.some(pad => pad && (pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -.5)) ? 'up' : null
  if (props.active !== false && !document.hidden && !launching.value) {
    if (down && !pressed) {
      if (cards.value.some(card => card === document.activeElement)) (document.activeElement as HTMLButtonElement).click()
      else focusCard()
    } else if (nextDirection && nextDirection !== direction) moveFocus(nextDirection)
  }
  direction = nextDirection
  pressed = down
  raf = requestAnimationFrame(pollGamepads)
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(pollGamepads)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
})
defineExpose({ focusCard })
</script>

<template>
  <main class="launcher" :aria-busy="launching !== null">
    <div class="launcher-content">
      <header class="launcher-header">
        <h1>选择模拟器</h1>
      </header>
      <section class="emulator-grid" aria-label="模拟器列表">
        <button v-for="emulator in emulators" :key="emulator.id" ref="cards"
          class="emulator-card" :disabled="launching !== null || active === false" @focus="focusedIndex = emulators.findIndex(item => item.id === emulator.id)" @click="enter(emulator.id)">
          <span class="console-art" aria-hidden="true">
            <svg v-if="emulator.id === 'arcade'" viewBox="0 0 240 140" fill="none">
              <path d="M72 8h96l10 31-10 43 18 16v34H54V98l18-16-10-43L72 8Z" fill="#414955" />
              <path d="M79 17h82l5 16H74l5-16Z" fill="#b75d44" />
              <rect x="78" y="40" width="84" height="42" rx="4" fill="#151b24" />
              <path d="m99 66 13-14 12 10 12-15 13 19" stroke="#7aaacf" stroke-width="3" />
              <path d="M71 89h98l12 14H59l12-14Z" fill="#647080" />
              <path d="M85 96v-9" stroke="#d4d6d8" stroke-width="3" /><circle cx="85" cy="85" r="5" fill="#d45359" />
              <circle cx="137" cy="96" r="3" fill="#e0b777" /><circle cx="149" cy="96" r="3" fill="#d45359" /><circle cx="161" cy="96" r="3" fill="#8facbe" />
              <rect x="97" y="114" width="46" height="12" rx="3" fill="#222831" />
            </svg>
            <svg v-else-if="emulator.id === 'gba'" viewBox="0 0 240 140" fill="none">
              <path d="M48 28h144c20 0 34 17 34 42s-14 42-34 42H48c-20 0-34-17-34-42s14-42 34-42Z" fill="#7770b4" />
              <rect x="73" y="35" width="94" height="70" rx="8" fill="#353449" />
              <rect x="82" y="43" width="76" height="51" rx="3" fill="#839ba6" />
              <path d="M41 56v10H31v10h10v10h10V76h10V66H51V56H41Z" fill="#252738" />
              <circle cx="199" cy="64" r="8" fill="#a9a5cd" /><circle cx="181" cy="80" r="8" fill="#a9a5cd" />
              <rect x="178" y="96" width="12" height="4" rx="2" fill="#36344c" />
              <path d="m91 78 12-16 13 9 14-17 20 24" stroke="#cee3ce" stroke-width="3" />
            </svg>
            <svg v-else-if="emulator.id === 'sfc'" viewBox="0 0 240 140" fill="none">
              <path d="M44 55c9-14 24-17 41-12l22 7h26l22-7c17-5 32-2 41 12l20 43c9 22-9 34-25 18l-28-23H77l-28 23c-16 16-34 4-25-18l20-43Z" fill="#c8cad1" />
              <path d="M59 57v12H47v12h12v12h12V81h12V69H71V57H59Z" fill="#4a4c59" />
              <circle cx="178" cy="61" r="9" fill="#4b78ba" /><circle cx="194" cy="77" r="9" fill="#d55d68" /><circle cx="162" cy="77" r="9" fill="#50a577" /><circle cx="178" cy="93" r="9" fill="#e5bd4e" />
              <path d="m104 80 10-7m12 7 10-7" stroke="#585a67" stroke-width="5" stroke-linecap="round" />
              <path d="M120 49V24" stroke="#7e8591" stroke-width="4" />
            </svg>
            <svg v-else-if="emulator.id === 'psp'" viewBox="0 0 240 140" fill="none">
              <rect x="10" y="30" width="220" height="80" rx="24" fill="#47515c" />
              <rect x="51" y="34" width="138" height="72" rx="7" fill="#151b24" />
              <rect x="59" y="40" width="122" height="60" rx="2" fill="#667f9e" />
              <path d="m70 83 24-21 15 11 20-18 39 28" stroke="#b4d6e9" stroke-width="4" stroke-linejoin="round" />
              <path d="M32 52h5v8h8v5h-8v8h-5v-8h-8v-5h8z" fill="#202731" />
              <circle cx="35" cy="89" r="7" fill="#8293a5" />
              <circle cx="207" cy="56" r="4" fill="#b4c3d2" /><circle cx="217" cy="66" r="4" fill="#b4c3d2" />
              <circle cx="197" cy="66" r="4" fill="#b4c3d2" /><circle cx="207" cy="76" r="4" fill="#b4c3d2" />
            </svg>
            <svg v-else viewBox="0 0 240 140" fill="none">
              <rect x="20" y="30" width="200" height="92" rx="12" fill="#d3d3d0" />
              <path d="M20 79h200v31a12 12 0 0 1-12 12H32a12 12 0 0 1-12-12V79Z" fill="#3d4147" />
              <rect x="43" y="49" width="76" height="8" rx="2" fill="#868a8c" />
              <path d="M56 88v10H46v10h10v10h10v-10h10V98H66V88H56Z" fill="#17191c" />
              <circle cx="173" cy="103" r="10" fill="#d45359" />
              <circle cx="199" cy="103" r="10" fill="#d45359" />
              <rect x="105" y="103" width="17" height="5" rx="2.5" fill="#9b9d9e" />
              <rect x="130" y="103" width="17" height="5" rx="2.5" fill="#9b9d9e" />
              <path d="M159 30V18h38v12" stroke="#d3d3d0" stroke-width="8" />
            </svg>
          </span>
          <span class="emulator-info">
            <strong>{{ emulator.name }}</strong>
            <span class="console-name">{{ emulator.description }}</span>
            <span class="detail">{{ launching === emulator.id ? '正在进入…' : emulator.detail }}</span>
          </span>
          <span class="enter-arrow" aria-hidden="true">→</span>
        </button>
      </section>
      <p v-if="error" class="launch-error" role="alert">进入失败：{{ error }}</p>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </main>
</template>

<style>
:root { color-scheme: dark; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #1a1a1a; color: #e8e8e8; }
* { box-sizing: border-box; }
html, body, #app { margin: 0; min-height: 100%; }
body { margin: 0; }
.launcher {
  height: 100dvh;
  overflow-y: auto;
  padding: max(clamp(20px, 7vh, 72px), env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  scroll-padding-block: 8px;
}
.launcher-content { display: flex; flex-direction: column; gap: 18px; width: 100%; max-width: 1040px; margin: 0 auto; }
.launcher h1 { font-size: clamp(22px, 3vw, 32px); line-height: 1.3; margin: 0; }
.emulator-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.emulator-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: clamp(12px, 2vw, 20px);
  min-width: 0;
  min-height: 112px;
  padding: clamp(14px, 2vw, 22px);
  text-align: left;
  font: inherit;
  color: inherit;
  background: #242424;
  border: 1px solid #404040;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color .18s, background .18s;
}
.emulator-card:hover { background: #2b2b2b; border-color: #a96569; }
.emulator-card:focus-visible { background: #292e36; border-color: #82b1ff; outline: 3px solid #82b1ff; outline-offset: 3px; }
.emulator-card:disabled { cursor: wait; opacity: .7; }
.console-art { display: grid; place-items: center; width: clamp(80px, 16vw, 152px); aspect-ratio: 4 / 3; background: #1c1e21; border-radius: 8px; }
.console-art svg { display: block; width: 90%; }
.emulator-info { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.emulator-info strong { font-size: clamp(18px, 2.4vw, 26px); line-height: 1.2; }
.console-name { color: #d0d0d0; font-size: 15px; }
.detail { color: #b8b8b8; font-size: 13px; line-height: 1.5; }
.enter-arrow { color: #f0b3b6; font-size: 22px; }
.launcher footer { color: #aaa; font-size: 12px; text-align: center; }
.launch-error { margin: 0; color: #ffb4b4; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
@media (max-width: 679px) {
  .emulator-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
}
@media (max-height: 440px) {
  .launcher { padding-block: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-bottom)); }
  .launcher-content { gap: 12px; }
  .console-art { width: clamp(80px, 12vw, 112px); }
}
@media (prefers-reduced-motion: reduce) { .emulator-card { transition: none; } }
</style>
