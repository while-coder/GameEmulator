<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { emulators, type EmulatorId } from './registry'

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
function focusCard() { cards.value[focusedIndex]?.focus() }
function moveFocus(step: number) {
  const current = cards.value.findIndex(card => card === document.activeElement)
  focusedIndex = current < 0 ? 0 : (current + step + cards.value.length) % cards.value.length
  focusCard()
}
function onKey(event: KeyboardEvent) {
  if (props.active === false) return
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    moveFocus(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
  }
}
let raf = 0
let pressed = false
let direction = 0
function pollGamepads() {
  const pads = Array.from(navigator.getGamepads?.() ?? [])
  const down = pads.some((pad) => pad?.buttons[0]?.pressed)
  const nextDirection = pads.some(pad => pad && (pad.buttons[15]?.pressed || pad.buttons[13]?.pressed || (pad.axes[0] ?? 0) > .5 || (pad.axes[1] ?? 0) > .5)) ? 1
    : pads.some(pad => pad && (pad.buttons[14]?.pressed || pad.buttons[12]?.pressed || (pad.axes[0] ?? 0) < -.5 || (pad.axes[1] ?? 0) < -.5)) ? -1 : 0
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
      <header>
        <span class="eyebrow">GAME EMULATOR</span>
        <h1>选择模拟器</h1>
        <p class="intro">从熟悉的游戏机，开始下一场冒险。</p>
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
.launcher { --accent: #d45359; min-height: 100dvh; padding: max(40px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); }
.launcher-content { max-width: 960px; margin: 0 auto; padding-top: clamp(0px, 5vh, 64px); }
.eyebrow { color: #b8b8b8; font-size: 12px; letter-spacing: .18em; }
.launcher h1 { font-size: clamp(28px, 4vw, 40px); letter-spacing: -.03em; margin: 14px 0 10px; }
.intro { color: #b8b8b8; line-height: 1.6; margin: 0; }
.emulator-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr)); gap: 24px; margin-top: 36px; }
.emulator-card { display: flex; flex-direction: column; text-align: left; font: inherit; color: inherit; background: #242424; border: 1px solid #404040; border-radius: 16px; padding: 24px; cursor: pointer; transition: border-color .18s, background .18s; }
.emulator-card:hover { background: #2b2b2b; border-color: #a96569; }
.emulator-card:focus-visible { outline: 3px solid #82b1ff; outline-offset: 5px; }
.emulator-card:disabled { cursor: wait; opacity: .7; }
.console-art { display: grid; place-items: center; height: 160px; width: 100%; background: #1c1e21; border-radius: 10px; margin-bottom: 24px; }
.console-art svg { width: min(100%, 240px); height: 140px; }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-heading strong { font-size: 24px; }
.badge { background: #253b30; color: #a2dbb4; padding: 4px 8px; border-radius: 5px; font-size: 12px; }
.console-name { margin-top: 8px; color: #c9c9c9; }
.detail { margin-top: 12px; color: #b8b8b8; font-size: 13px; line-height: 1.6; }
.enter-label { display: flex; justify-content: space-between; border-top: 1px solid #404040; padding-top: 18px; margin-top: 24px; color: #f0b3b6; font-weight: 600; }
.launcher footer { margin-top: 32px; color: #aaa; font-size: 13px; }
.launch-error { color: #ffb4b4; line-height: 1.6; }
@media (max-width: 480px) { .launcher { padding-top: max(28px, env(safe-area-inset-top)); } .emulator-grid { margin-top: 28px; } }
@media (max-height: 700px) { .launcher { padding-top: max(24px, env(safe-area-inset-top)); } .launcher-content { padding-top: 0; } .console-art { height: 130px; margin-bottom: 18px; } .emulator-grid { margin-top: 24px; } }
@media (prefers-reduced-motion: reduce) { .emulator-card { transition: none; } }
</style>
