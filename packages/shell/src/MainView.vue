<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { emulators, type EmulatorId } from './registry'
import { appName } from './branding'
import '../../player-ui/interaction.css'
import { createNavigationRepeatGuard, focusNavigationElement, pickNeighbor, type NavigationDirection } from '../../player-ui/remoteNavigation'

const props = withDefaults(defineProps<{ launch: (id: EmulatorId) => Promise<void>; active?: boolean }>(), { active: true })
const busy = ref(false)
const error = ref('')
const cards = ref<HTMLButtonElement[]>([])
let focusedIndex = 0
async function enter(id: EmulatorId) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await props.launch(id) }
  catch (err) { error.value = err instanceof Error ? err.message : String(err) }
  finally { busy.value = false }
}
function focusCard() {
  const card = cards.value[focusedIndex]
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
  if (props.active === false || busy.value || event.defaultPrevented) return
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
  if (props.active !== false && !document.hidden && !busy.value) {
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
  <main class="launcher" :aria-busy="busy">
    <div class="launcher-content">
      <header class="launcher-header">
        <span class="eyebrow">{{ appName }}</span>
        <h1>选择模拟器</h1>
      </header>
      <section class="emulator-grid" aria-label="模拟器列表">
        <button v-for="emulator in emulators" :key="emulator.id" ref="cards"
          class="emulator-card" :disabled="busy || active === false" @focus="focusedIndex = emulators.findIndex(item => item.id === emulator.id)" @click="enter(emulator.id)">
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
          <span class="card-heading"><strong>{{ emulator.name }}</strong><span class="badge">可游玩</span></span>
          <span class="console-name">{{ emulator.description }}</span>
          <span class="detail">{{ emulator.detail }}</span>
          <span class="enter-label">{{ busy ? '正在进入…' : '进入模拟器' }} <span aria-hidden="true">→</span></span>
        </button>
      </section>
      <p v-if="error" class="launch-error" role="alert">进入失败：{{ error }}</p>
      <footer>更多模拟器将陆续加入<slot name="footer" /></footer>
    </div>
  </main>
</template>

<style>
:root { color-scheme: dark; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #1a1a1a; color: #e8e8e8; }
* { box-sizing: border-box; }
html, body, #app { margin: 0; min-height: 100%; }
body { margin: 0; }
.launcher { --accent: #d45359; height: 100dvh; overflow: hidden; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
.launcher-content { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 1440px; height: 100%; min-height: 0; margin: 0 auto; }
.launcher-header { flex: 0 0 auto; text-align: center; }
.eyebrow { color: #b8b8b8; font-size: 11px; letter-spacing: .18em; }
.launcher h1 { display: flex; align-items: center; gap: 16px; font-size: clamp(20px, 3vw, 28px); line-height: 1.3; letter-spacing: -.03em; margin: 4px 0 0; }
.launcher h1::before, .launcher h1::after { content: ''; flex: 1; height: 1px; background: #404040; }
/* A single horizontal rail owns scrolling; the page itself always fits the viewport. */
.emulator-grid { display: flex; flex: 1; min-height: 0; min-width: 0; align-items: center; gap: 16px; padding: 6px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-padding-inline: 6px; scrollbar-width: thin; }
.emulator-card { display: flex; flex: 0 0 clamp(220px, 30vw, 300px); flex-direction: column; min-width: 0; height: 100%; max-height: 400px; text-align: left; font: inherit; color: inherit; background: #242424; border: 1px solid #404040; border-radius: 12px; padding: 16px; cursor: pointer; scroll-snap-align: start; transition: border-color .18s, background .18s; }
.emulator-card:hover { background: #2b2b2b; border-color: #a96569; }
.emulator-card:focus-visible { outline: 3px solid #82b1ff; outline-offset: 5px; }
.emulator-card:disabled { cursor: wait; opacity: .7; }
.console-art { display: grid; flex: 1; min-height: 0; place-items: center; width: 100%; overflow: hidden; background: #1c1e21; border-radius: 8px; margin-bottom: 14px; }
.console-art svg { width: min(100%, 240px); height: 100%; max-height: 160px; }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-heading strong { font-size: 22px; }
.badge { background: #253b30; color: #a2dbb4; padding: 4px 8px; border-radius: 5px; font-size: 12px; }
.console-name { margin-top: 8px; color: #c9c9c9; }
.detail { margin-top: 8px; color: #b8b8b8; font-size: 12px; line-height: 1.5; }
.enter-label { display: flex; justify-content: space-between; border-top: 1px solid #404040; padding-top: 12px; margin-top: 14px; color: #f0b3b6; font-size: 14px; font-weight: 600; }
.card-heading, .console-name, .detail, .enter-label { flex-shrink: 0; }
.launcher footer { flex-shrink: 0; color: #aaa; font-size: 12px; text-align: center; }
.launch-error { flex-shrink: 0; margin: 0; color: #ffb4b4; font-size: 12px; line-height: 1.4; }
@media (max-height: 440px) {
  .launcher { padding-top: max(10px, env(safe-area-inset-top)); padding-bottom: max(8px, env(safe-area-inset-bottom)); }
  .launcher-content { gap: 6px; }
  .launcher h1 { font-size: 20px; }
  .emulator-grid { gap: 12px; }
  .emulator-card { padding: 12px; }
  .console-art { margin-bottom: 8px; }
  .card-heading strong { font-size: 18px; }
  .badge { padding: 3px 6px; font-size: 11px; }
  .console-name { margin-top: 4px; font-size: 13px; }
  .detail { margin-top: 4px; }
  .enter-label { padding-top: 8px; margin-top: 8px; font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) { .emulator-card { transition: none; } }
</style>
