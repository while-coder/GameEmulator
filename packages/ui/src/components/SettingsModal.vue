<script setup lang="ts">
import SSlider from '@qingfeng346/ui-kit/components/SSlider.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SSwitch from '@qingfeng346/ui-kit/components/SSwitch.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  PAD_BUTTON_LIST,
  PLAYER_LABELS,
  SPEED_OPTIONS,
  TURBO_HZ_OPTIONS,
  codeLabel,
  detectPadSignal,
  listGamepads,
  padLabel,
  padmapFor,
  resetKeymap,
  resetSettings,
  setPadBinding,
  settings,
  syncGamepadAssignments,
  type Aspect,
  type TouchPadMode,
} from '../emulator/settings'
import { navEnabled, useRemoteNav } from '../composables/useRemoteNav'
import RemoteSelect from './RemoteSelect.vue'
import RomStorePanel from './RomStorePanel.vue'
import SaveStatePanel, { type LoadSavePayload } from './SaveStatePanel.vue'

const open = defineModel<boolean>('open', { default: false })

type Tab = 'library' | 'saves' | 'keys' | 'display' | 'audio' | 'misc'
const tab = defineModel<Tab>('tab', { default: 'library' })
defineProps<{ currentRomKey?: string | null }>()
const emit = defineEmits<{
  loadRom: [{ name: string; bytes: Uint8Array; key: string }]
  loadSave: [LoadSavePayload]
  editTouchLayout: []
}>()
const libraryPanel = ref<InstanceType<typeof RomStorePanel> | null>(null)
const savePanel = ref<InstanceType<typeof SaveStatePanel> | null>(null)
defineExpose({ refreshSaves: () => savePanel.value?.refreshCreatedSave() })
const busy = computed(() => libraryPanel.value?.busyKey != null || savePanel.value?.busyKey != null)
const libraryOpen = computed({ get: () => open.value && tab.value === 'library', set: (v) => { if (!v) open.value = false } })
const savesOpen = computed({ get: () => open.value && tab.value === 'saves', set: (v) => { if (!v) open.value = false } })

watch(tab, () => {
  capturing.value = null
  stopCapturePad()
})

// 当前正在编辑的玩家(0=玩家1、1=玩家2)。
const player = ref(0)
const currentPlayer = computed(() => settings.players[player.value])

// 已连接手柄列表(随插拔刷新),显示自动分配结果。
const gamepads = ref<{ index: number; id: string }[]>([])
function refreshGamepads() {
  syncGamepadAssignments()
  gamepads.value = listGamepads()
}

// 手柄自动分配;映射始终属于当前玩家,未连接时也显示其已保存配置。
const currentPad = computed(() => gamepads.value.find((g) => g.index === currentPlayer.value.gamepadIndex))
const currentPadmap = computed(() => padmapFor(player.value))
watch(() => [player.value, currentPlayer.value.gamepadIndex], () => {
  capturing.value = null
  stopCapturePad()
})

const speedOptions = SPEED_OPTIONS.map((s) => ({ value: s, label: `${s}×` }))
const turboOptions = TURBO_HZ_OPTIONS.map((h) => ({ value: h, label: `${h} 次/秒` }))

const TABS: { key: Tab; label: string }[] = [
  { key: 'library', label: '游戏库' },
  { key: 'saves', label: '存档' },
  { key: 'keys', label: '按键' },
  { key: 'display', label: '显示' },
  { key: 'audio', label: '音频' },
  { key: 'misc', label: '其他' },
]

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '1:1', label: '方像素 1:1' },
  { value: '8:7', label: '8:7' },
  { value: '4:3', label: '4:3' },
]

const TOUCH_MODES: { value: TouchPadMode; label: string }[] = [
  { value: 'auto', label: '默认(桌面隐藏，移动端显示)' },
  { value: 'always', label: '显示' },
  { value: 'never', label: '隐藏' },
]

// 按键捕获:记录正在等待按键的按钮(null 表示未捕获)。
const capturing = ref<number | null>(null)

function startCapture(btn: number) {
  stopCapturePad()
  capturing.value = btn
}

function onCaptureKey(e: KeyboardEvent) {
  if (capturing.value === null) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') {
    capturing.value = null
    return
  }
  // 若该 code 已绑到当前玩家的别的按钮,先解绑,避免冲突。
  const keymap = currentPlayer.value.keymap
  for (const [b, code] of Object.entries(keymap)) {
    if (code === e.code && Number(b) !== capturing.value) {
      keymap[Number(b)] = ''
    }
  }
  keymap[capturing.value] = e.code
  capturing.value = null
}

// 捕获态下在捕获阶段拦截全局按键(避免触发游戏输入)。
watch(capturing, (v) => {
  if (v !== null) {
    window.addEventListener('keydown', onCaptureKey, true)
  } else {
    window.removeEventListener('keydown', onCaptureKey, true)
  }
})

// ===== 手柄按键捕获:点击后轮询 Gamepad,捕获按下的第一个输入 =====
const capturingPad = ref<number | null>(null)
let padRaf = 0
// 录入起始时的手柄基线快照,只识别相对基线“新发生”的输入,避免把已按住的键/扳机偏置当成输入。
let padBaseline: Pick<Gamepad, 'buttons' | 'axes'> | null = null
// 固定录入目标玩家与设备,切换玩家或设备时取消。
let capturePadIndex: number | null = null
let capturePlayer: number | null = null

function startCapturePad(btn: number) {
  if (!currentPad.value) return // 未连接手柄不可录入
  capturing.value = null
  capturingPad.value = btn
  capturePadIndex = currentPlayer.value.gamepadIndex
  capturePlayer = player.value
  padBaseline = null
  if (!padRaf) padRaf = requestAnimationFrame(pollCapturePad)
}

function stopCapturePad() {
  capturingPad.value = null
  capturePadIndex = null
  capturePlayer = null
  padBaseline = null
  if (padRaf) {
    cancelAnimationFrame(padRaf)
    padRaf = 0
  }
}

function pollCapturePad() {
  if (capturingPad.value === null) {
    padRaf = 0
    return
  }
  padRaf = requestAnimationFrame(pollCapturePad)
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  // 只读该玩家绑定的那一个手柄,避免另一个手柄的输入串入。
  const pad = capturePadIndex !== null ? pads[capturePadIndex] : null
  if (!pad) { stopCapturePad(); return }
  if (!padBaseline) {
    padBaseline = { buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value, touched: b.touched })), axes: [...pad.axes] }
    return
  }
  const sig = detectPadSignal(pad, padBaseline)
  padBaseline = {
    buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value, touched: b.touched })),
    axes: [...pad.axes],
  }
  if (sig && capturePlayer !== null) {
    setPadBinding(capturePlayer, capturingPad.value, sig)
    stopCapturePad()
  }
}

function onOverlayKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (capturingPad.value !== null) {
    stopCapturePad() // 手柄录入中:Esc 取消录入,不关闭面板
  } else if (capturing.value === null) {
    close()
  }
}

function close() {
  if (busy.value) return
  capturing.value = null
  stopCapturePad()
  open.value = false
}

// Android TV 遥控器:设置面板内焦点导航(tab/玩家切换/改键/各控件/关闭)。
// 改键捕获态(capturing / capturingPad)时让位 —— 此时键盘/手柄全交给捕获逻辑。
const panelRef = ref<HTMLElement | null>(null)
useRemoteNav({
  container: panelRef,
  active: computed(
    () => navEnabled.value && open.value && capturing.value === null && capturingPad.value === null,
  ),
  onBack: close,
  autoFocus: true,
  priority: 10,
})

const volumePct = computed({
  get: () => Math.round(settings.audio.volume * 100),
  set: (v: number) => {
    settings.audio.volume = v / 100
  },
})

// 打开面板时刷新手柄列表(可能在打开前才插上)。
watch(open, (v) => {
  if (v) refreshGamepads()
  else { capturing.value = null; stopCapturePad() }
})

onMounted(() => {
  refreshGamepads()
  window.addEventListener('gamepadconnected', refreshGamepads)
  window.addEventListener('gamepaddisconnected', refreshGamepads)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCaptureKey, true)
  window.removeEventListener('gamepadconnected', refreshGamepads)
  window.removeEventListener('gamepaddisconnected', refreshGamepads)
  stopCapturePad()
})
</script>

<template>
  <SModal
    v-model:show="open"
    title="设置"
    width="1040px"
    fill-height
    :closable="!busy"
    :mask-closable="!busy"
    class="player-modal settings-modal"
    :close-on-esc="false"
    :body-scrollable="false"
    @close="close"
    @keydown="onOverlayKey"
  >
    <div ref="panelRef" class="settings-content">
      <nav class="tabs" role="tablist" aria-label="设置分类">
        <SButton
          v-for="t in TABS"
          :key="t.key"
          :class="['tab', { active: tab === t.key }]"
          :id="`settings-tab-${t.key}`"
          role="tab"
          :aria-selected="tab === t.key"
          :aria-controls="`settings-panel-${tab}`"
          :disabled="busy"
          @click="tab = t.key"
        >
          {{ t.label }}
        </SButton>
      </nav>

      <fieldset class="settings-actions" :disabled="busy"><slot name="actions" :tab="tab" /></fieldset>
      <section :id="`settings-panel-${tab}`" class="body" :class="{ 'list-body': tab === 'library' || tab === 'saves' }" role="tabpanel" :aria-labelledby="`settings-tab-${tab}`">
        <RomStorePanel v-if="tab === 'library'" ref="libraryPanel" v-model:open="libraryOpen" @load="emit('loadRom', $event)" />
        <SaveStatePanel v-else-if="tab === 'saves'" ref="savePanel" v-model:open="savesOpen" :current-rom-key="currentRomKey" @load="emit('loadSave', $event)" />
        <!-- 按键 -->
        <div v-else-if="tab === 'keys'" class="keys">
          <div class="touch-layout-setting">
            <span>触屏按键布局</span>
            <SButton @click="emit('editTouchLayout')">调整位置</SButton>
          </div>
          <SHint class="tip">拖动摇杆、A/B 和两组功能键调整位置，横屏与竖屏分别保存。</SHint>
          <!-- 玩家切换 -->
          <div class="player-switch">
            <SButton
              v-for="(label, pi) in PLAYER_LABELS"
              :key="pi"
              :class="['player-btn', { active: player === pi }]"
              @click="player = pi"
            >
              {{ label }}
            </SButton>
          </div>

          <SHint class="tip">{{ player === 0 ? '支持画面摇杆、手柄和键盘同时操作。' : '支持手柄和键盘同时操作。' }}</SHint>
          <div class="pad-assign" role="status">
            <span>自动分配手柄</span>
            <span class="pad-name">{{ currentPad ? `#${currentPad.index + 1} ${currentPad.id}` : '未连接，请连接手柄并按任意键激活' }}</span>
          </div>
          <SHint class="tip">
            手柄按连接或激活顺序分配给玩家一、玩家二。每位玩家的键盘与手柄配置独立保存。
            点击下方按键后输入新绑定（Esc 取消）；连发 A/B 为按住自动连按。
          </SHint>
          <div class="key-head">
            <span class="key-name"></span>
            <span class="col-head">键盘</span>
            <span class="col-head">手柄</span>
          </div>
          <div v-for="item in PAD_BUTTON_LIST" :key="item.btn" class="key-row">
            <span class="key-name">{{ item.label }}</span>
            <SButton
              :class="['key-bind', { capturing: capturing === item.btn }]"
              @click="startCapture(item.btn)"
            >
              {{ capturing === item.btn ? '按下任意键…' : codeLabel(currentPlayer.keymap[item.btn]) }}
            </SButton>
            <SButton
              :class="['key-bind', { capturing: capturingPad === item.btn }]"
              :disabled="!currentPad"
              @click="startCapturePad(item.btn)"
            >
              {{
                capturingPad === item.btn
                  ? '按下手柄键…'
                  : padLabel(currentPadmap[item.btn])
              }}
            </SButton>
          </div>
          <SButton class="reset" @click="resetKeymap(player)">恢复当前玩家默认按键</SButton>
        </div>

        <!-- 显示 -->
        <div v-else-if="tab === 'display'" class="form">
          <label class="row">
            <span>画面平滑</span>
            <SSwitch v-model:value="settings.display.smoothing" />
          </label>
          <label class="row">
            <span>宽高比</span>
            <RemoteSelect v-model="settings.display.aspect" :options="ASPECTS" />
          </label>
          <label class="row">
            <span>整数倍缩放</span>
            <SSwitch v-model:value="settings.display.integerScale" />
          </label>
          <label class="row">
            <span>扫描线(CRT)</span>
            <SSwitch v-model:value="settings.display.scanlines" />
          </label>
          <label class="row">
            <span>背景色</span>
            <input v-model="settings.display.bgColor" type="color" />
          </label>
        </div>

        <!-- 音频 -->
        <div v-else-if="tab === 'audio'" class="form">
          <label class="row">
            <span>音量 {{ volumePct }}%</span>
            <SSlider v-model:value="volumePct" :min="0" :max="100" aria-label="音量" />
          </label>
        </div>

        <!-- 杂项 -->
        <div v-else class="form">
          <label class="row">
            <span>触屏手柄</span>
            <RemoteSelect v-model="settings.misc.touchPad" :options="TOUCH_MODES" />
          </label>
          <label class="row">
            <span>运行速度</span>
            <RemoteSelect v-model="settings.misc.speed" :options="speedOptions" />
          </label>
          <label class="row">
            <span>连发频率</span>
            <RemoteSelect v-model="settings.misc.turboHz" :options="turboOptions" />
          </label>
          <label class="row">
            <span>显示按下的按键<br /><SHint class="hint-text">调试用,状态栏实时显示键盘/手柄/遥控按键</SHint></span>
            <SSwitch v-model:value="settings.misc.showInputDebug" />
          </label>
          <SButton class="reset" @click="resetSettings">恢复全部默认设置</SButton>
        </div>
      </section>
    </div>
  </SModal>
</template>

<style scoped>
.settings-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.tab {
  border: none;
  background: transparent;
  color: #aaa;
  padding: 6px 12px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  background: #3a3a3a;
  color: #fff;
}
.body {
  padding: 16px;
  overflow-y: auto;
}
.touch-layout-setting { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.player-switch {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.player-btn {
  flex: 1;
  border: 1px solid #4a4a4a;
  background: #333;
  color: #ccc;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.player-btn.active {
  background: #2f6f9f;
  border-color: #2f6f9f;
  color: #fff;
}
.pad-assign {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
}
.pad-name {
  max-width: 65%;
  overflow-wrap: anywhere;
  text-align: right;
  color: #ccc;
  font-size: 13px;
}
.tip {
  margin: 0 0 12px;
  color: #888;
  font-size: 12px;
}
.hint-text {
  color: #888;
  font-size: 11px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}
/* 按键页:名称 | 键盘 | 手柄 三列网格,表头与各行对齐。 */
.key-head,
.key-row {
  display: grid;
  grid-template-columns: 1fr 110px 110px;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.col-head {
  color: #888;
  font-size: 12px;
  text-align: center;
}
.key-name {
  color: #ddd;
}
.key-bind {
  min-height: 44px;
  border: 1px solid #4a4a4a;
  background: #333;
  color: #eee;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: center;
}
.key-bind:focus-visible { outline: 2px solid #4ea1ff; outline-offset: 2px; }
.key-bind.capturing {
  border-color: #c0392b;
  color: #ffb3aa;
}
.row select,
.row .remote-select,
.row input[type='range'] {
  min-width: 160px;
}
.row input[type='color'] {
  width: 48px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
}
.reset {
  margin-top: 12px;
  border: 1px solid #4a4a4a;
  background: #333;
  color: #eee;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.reset:hover {
  background: #444;
}
</style>

<style scoped>
.settings-content { flex: 1; overflow: hidden; }
.settings-actions { display: flex; flex-wrap: wrap; flex-shrink: 0; gap: 8px; min-width: 0; margin: 0; padding: 8px 16px; border: none; }
.settings-actions:empty { display: none; }
.tabs { flex-shrink: 0; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #3a3a3a; }
.tab { min-height: 44px; border-radius: 6px; }
.tab:focus-visible { outline: 2px solid #4ea1ff; outline-offset: -2px; }
.body { flex: 1; min-height: 0; }
.body.list-body { display: flex; overflow: hidden; padding: 0; }
.keys, .form { max-width: 640px; margin: 0 auto; }
@media (max-width: 480px) {
  .tabs { gap: 2px; padding: 4px; }
  .tab { flex: 1; padding: 6px; font-size: 13px; }
  .key-head, .key-row { grid-template-columns: minmax(0, 1fr) repeat(2, minmax(0, 100px)); gap: 4px; }
  .key-bind { padding: 6px 4px; }
  .pad-assign .remote-select { min-width: 0; max-width: 65%; }
}
@media (orientation: landscape) and (max-height: 540px) {
  .settings-content {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .tabs {
    grid-column: 1;
    grid-row: 1 / -1;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 4px;
    padding: 6px;
    overflow-y: auto;
    border-bottom: none;
    border-right: 1px solid #3a3a3a;
  }
  .tab { flex: 0 0 auto; width: 100%; padding: 6px; }
  .settings-actions {
    grid-column: 2;
    grid-row: 1;
    align-items: center;
    min-height: 52px;
    padding: 4px 56px 4px 12px;
    border-bottom: 1px solid #3a3a3a;
  }
  .settings-actions:empty { display: flex; }
  .body { grid-column: 2; grid-row: 2; padding: 8px 12px; }
  .body.list-body { padding: 0; }
}
</style>

<style>
.settings-modal .s-modal-body { flex: 1; }
.settings-modal .s-modal-header { flex-shrink: 0; }
@media (orientation: landscape) and (max-height: 540px) {
  .settings-modal.s-modal-overlay {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .settings-modal .s-modal-box.fill-height {
    position: relative;
    width: 100% !important;
    height: 100%;
    max-height: 100%;
    border: none;
    border-radius: 0;
  }
  .settings-modal .s-modal-header {
    position: absolute;
    top: 4px;
    right: 6px;
    z-index: 1;
    padding: 0;
    border: none;
  }
  .settings-modal .s-modal-titles {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .settings-modal .s-icon-close { width: 44px; height: 44px; }
}
</style>

<style scoped>
@media (pointer: coarse) {
  .tabs { gap: 4px; padding: 4px 8px; }
  .tab { min-height: var(--player-control-height); padding: 4px 8px; }
  .settings-actions {
    min-height: calc(var(--player-control-height) + 12px);
    gap: var(--player-control-gap);
    padding-block: var(--player-tools-padding);
  }
  .body:not(.list-body) { padding: 8px 12px; }
  .row, .pad-assign { min-height: calc(var(--player-control-height) + 8px); padding-block: 4px; gap: 8px; }
  .row .remote-select, .row input[type='range'] { min-width: 0; width: 60%; max-width: 240px; }
  .key-head, .key-row { padding-block: 3px; }
  .player-switch { margin-bottom: 8px; }
  .tip { margin-bottom: 8px; line-height: 1.4; }
  .reset { margin-top: 8px; }
}
@media (pointer: coarse) and (orientation: landscape) and (max-height: 540px) {
  .tabs { padding: 4px 6px; }
  .settings-actions { padding-right: 56px; }
}
</style>
