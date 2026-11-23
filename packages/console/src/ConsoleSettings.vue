<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SSwitch from '@qingfeng346/ui-kit/components/SSwitch.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import RemoteSelect from '../../player-ui/RemoteSelect.vue'
import { useRemoteNav } from '../../player-ui/useRemoteNav'
import { isStickKey, keyboardActions, PADMAP, PSP_BUTTON_LABELS, systems, type KeyboardAction, type ConsoleSettings, type ConsoleSystem } from './systems'
import type { Game } from './store'
import mgbaLicense from './assets/MGBA-LICENSE.txt?raw'
import pspLicense from './assets/psp/PPSSPP-LICENSE.txt?raw'
import snesLicense from './assets/SNES9X-LICENSE.txt?raw'
import retroarchLicense from '../../arcade/src/assets/cores/RETROARCH-COPYING.txt?raw'
import '../../player-ui/settings.css'

type Tab = 'keys' | 'display' | 'audio' | 'misc'
const props = defineProps<{
  system: ConsoleSystem
  settings: ConsoleSettings
  current: Game | null
  busy: boolean
  error: string
  message?: string
}>()
const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<Tab>('tab', { required: true })
const emit = defineEmits<{
  import: []
  editLayout: []
  resetKeys: [player: number]
  restart: []
}>()
const config = systems[props.system]
const keyActions = keyboardActions(props.system)
const tabs = [{ id: 'keys', label: '按键' }, { id: 'display', label: '显示' }, { id: 'audio', label: '音频' }, { id: 'misc', label: '其他' }] as const
const panel = ref<HTMLElement | null>(null)
const player = ref(0), capturing = ref<KeyboardAction | null>(null)
const actionNames: Partial<Record<KeyboardAction, string>> = { up: '↑ 上', down: '↓ 下', left: '← 左', right: '→ 右', start: '开始 Start', select: '选择 Select', l: 'L 肩键', r: 'R 肩键', stickUp: '摇杆 ↑', stickDown: '摇杆 ↓', stickLeft: '摇杆 ←', stickRight: '摇杆 →' }
const padNames: Record<number, string> = { 0: 'A / ×', 1: 'B / ○', 2: 'X / □', 3: 'Y / △', 4: 'LB / L1', 5: 'RB / R1', 8: 'Select / Back', 9: 'Start', 12: '↑', 13: '↓', 14: '←', 15: '→' }
const keyLabel = (code?: string) => code ? code.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→') : '未绑定'

function cancelEdit() {
  if (capturing.value) { capturing.value = null; return true }
  return false
}
function close() {
  if (props.busy || cancelEdit()) return
  const filter = document.querySelector<HTMLElement>('.rs-backdrop')
  if (filter) { filter.click(); return }
  show.value = false
}
function captureKey(event: KeyboardEvent) {
  if (!capturing.value) return false
  event.preventDefault(); event.stopImmediatePropagation()
  if (event.code !== 'Escape') {
    const map = props.settings.keymaps[player.value]
    for (const action of keyActions) if (map[action] === event.code) map[action] = ''
    map[capturing.value] = event.code
  }
  capturing.value = null
  return true
}
watch(capturing, value => {
  if (value) window.addEventListener('keydown', captureKey, true)
  else window.removeEventListener('keydown', captureKey, true)
}, { flush: 'sync' })
watch([show, tab, player], () => { capturing.value = null })
useRemoteNav({ container: panel, active: computed(() => show.value && !props.busy && !capturing.value), priority: 10, autoFocus: true, onBack: close })
onBeforeUnmount(() => window.removeEventListener('keydown', captureKey, true))
defineExpose({ cancelEdit, captureKey })
</script>

<template>
  <SModal :show="show" title="设置" width="1040px" fill-height class="player-modal console-settings-modal" :closable="!busy" :mask-closable="!busy" :close-on-esc="false" :body-scrollable="false" @update:show="value => { if (!value) close() }">
    <div ref="panel" class="player-settings">
      <nav class="player-settings-tabs" role="tablist" :aria-label="`${config.name}设置分类`">
        <SButton v-for="item in tabs" :id="`console-tab-${item.id}`" :key="item.id" :class="{ active: tab === item.id }" role="tab" :aria-selected="tab === item.id" :aria-controls="`console-panel-${item.id}`" :disabled="busy" @click="tab = item.id">{{ item.label }}</SButton>
      </nav>
      <p v-if="error" class="library-action-error" role="alert">{{ error }}</p>
      <p v-else-if="message" role="status">{{ message }}</p>
      <fieldset :id="`console-panel-${tab}`" class="player-settings-body" :disabled="busy" role="tabpanel" :aria-labelledby="`console-tab-${tab}`">
        <section v-if="tab === 'keys'" class="keys-page">
          <section class="keyboard-help"><h3>快捷键</h3><dl><dt><kbd>Esc</kbd></dt><dd>游戏中打开暂停菜单，再按一次继续游戏。</dd><dt><kbd>Ctrl+S / F8</kbd></dt><dd>保存本游戏快速存档。</dd><dt><kbd>F9</kbd></dt><dd>读取本游戏快速存档。</dd><dt><kbd>F11</kbd></dt><dd>全屏 / 窗口切换。</dd></dl></section>
          <div class="touch-layout-setting"><span>触屏按键布局</span><SButton @click="emit('editLayout')">编辑布局</SButton></div>
          <SHint>方向键可调整大小，每个动作按钮可独立移动、缩放或隐藏；横屏与竖屏分别保存。</SHint>
          <div class="player-switch"><SButton v-for="index in config.players" :key="index" :class="{ active: player === index - 1 }" @click="player = index - 1">玩家 {{ index }}</SButton></div>
          <SHint>键盘与标准手柄可同时操作。点击键盘列修改绑定，Esc 取消。手柄按连接顺序分配；同时按 L3 + R3 可暂停。{{ system === 'psp' ? '左摇杆控制 PSP 模拟摇杆，方向键独立。' : system === 'gba' ? '掌机当前支持单机游玩。' : '' }}</SHint>
          <div class="key-heading"><span>操作</span><span>键盘</span><span>手柄</span></div>
          <div v-for="action in keyActions" :key="action" class="arcade-key-row"><span>{{ actionNames[action] || (system === 'psp' && !isStickKey(action) && PSP_BUTTON_LABELS[action]) || action.toUpperCase() }}</span><SButton :class="{ active: capturing === action }" @click="capturing = action">{{ capturing === action ? '按下新按键…' : keyLabel(settings.keymaps[player][action]) }}</SButton><span>{{ isStickKey(action) ? actionNames[action]?.replace('摇杆', '左摇杆') : padNames[PADMAP[action]] }}</span></div>
          <SButton @click="emit('resetKeys', player)">恢复当前玩家默认按键</SButton>
        </section>
        <section v-else-if="tab === 'display'" class="display-page">
          <label>画面平滑<SSwitch v-model:value="settings.smoothing" /></label>
          <label>宽高比<RemoteSelect v-model="settings.aspect" :options="[{ value: 'auto', label: '自动（跟随游戏）' }, { value: '4:3', label: '4:3' }, ...(system === 'psp' ? [{ value: '16:9', label: '16:9' }] : []), { value: '3:2', label: '3:2' }, { value: '10:9', label: '10:9' }, { value: '1:1', label: '1:1' }]" /></label>
        </section>
        <section v-else-if="tab === 'audio'" class="display-page"><label>静音<SSwitch v-model:value="settings.muted" /></label></section>
        <section v-else class="display-page">
          <label>触屏手柄<RemoteSelect v-model="settings.touch" :options="[{ value: 'auto', label: '默认（桌面隐藏，移动端显示）' }, { value: 'always', label: '显示' }, { value: 'never', label: '隐藏' }]" /></label>
          <div class="row"><span>本地游戏</span><SButton @click="emit('import')">导入游戏</SButton></div>
          <div v-if="current" class="row"><span>重新开始当前游戏</span><SButton @click="emit('restart')">重新开始</SButton></div>
          <details class="core-licenses"><summary>开源许可</summary><h4>{{ config.core }}</h4><pre>{{ system === 'psp' ? pspLicense : system === 'gba' ? mgbaLicense : snesLicense }}</pre><template v-if="system !== 'psp'"><h4>RetroArch</h4><pre>{{ retroarchLicense }}</pre></template></details>
        </section>
      </fieldset>
    </div>
  </SModal>
</template>

<style scoped>
.touch-layout-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.player-switch { margin-top: 16px !important; }
.core-licenses { margin-top: 20px; }
.core-licenses pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; max-height: 300px; overflow: auto; }
</style>
