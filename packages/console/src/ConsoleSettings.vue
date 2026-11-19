<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SIconButton from '@qingfeng346/ui-kit/components/button/SIconButton.vue'
import SInput from '@qingfeng346/ui-kit/components/input/SInput.vue'
import SSwitch from '@qingfeng346/ui-kit/components/SSwitch.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SEmpty from '@qingfeng346/ui-kit/components/SEmpty.vue'
import STag from '@qingfeng346/ui-kit/components/STag.vue'
import RemoteSelect from '../../player-ui/RemoteSelect.vue'
import { useRemoteNav } from '../../player-ui/useRemoteNav'
import { createGameSearch, compareGameNames } from '../../shared/gameText'
import { PADMAP, systems, type Action, type ConsoleSettings, type ConsoleSystem } from './systems'
import type { Game, Snapshot } from './store'
import mgbaLicense from './assets/MGBA-LICENSE.txt?raw'
import snesLicense from './assets/SNES9X-LICENSE.txt?raw'
import retroarchLicense from '../../arcade/src/assets/cores/RETROARCH-COPYING.txt?raw'
import '../../player-ui/settings.css'

type Tab = 'saves' | 'keys' | 'display' | 'audio' | 'misc'
const props = defineProps<{
  system: ConsoleSystem
  settings: ConsoleSettings
  states: Snapshot[]
  games: Game[]
  current: Game | null
  busy: boolean
  error: string
}>()
const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<Tab>('tab', { required: true })
const emit = defineEmits<{
  save: []
  restore: [state: Snapshot]
  remove: [state: Snapshot]
  rename: [state: Snapshot, label: string]
  import: []
  editLayout: []
  resetKeys: [player: number]
  restart: []
}>()
const config = systems[props.system]
const tabs = [{ id: 'saves', label: '存档' }, { id: 'keys', label: '按键' }, { id: 'display', label: '显示' }, { id: 'audio', label: '音频' }, { id: 'misc', label: '其他' }] as const
const panel = ref<HTMLElement | null>(null)
const player = ref(0), capturing = ref<Action | null>(null)
const editingKey = ref<string | null>(null), editingText = ref('')
const saveQuery = ref(''), saveFilter = ref('all')
const gameNames = computed(() => new Map(props.games.map(game => [game.hash, game.name])))
const gameName = (state: Snapshot) => gameNames.value.get(state.hash) || state.gameName || '未收录游戏'
const saveFilterOptions = computed(() => [
  { value: 'all', label: '全部游戏' },
  ...(props.current ? [{ value: 'current', label: '本游戏' }] : []),
  ...[...new Map(props.states.map(state => [state.hash, { value: state.hash, label: gameName(state) }])).values()].sort((a, b) => compareGameNames(a.label, b.label)),
])
const filteredStates = computed(() => {
  const matches = createGameSearch(saveQuery.value)
  return props.states.filter(state => (saveFilter.value === 'all' || state.hash === (saveFilter.value === 'current' ? props.current?.hash : saveFilter.value)) && matches([state.label, gameName(state)]))
})
const actionNames: Partial<Record<Action, string>> = { up: '↑ 上', down: '↓ 下', left: '← 左', right: '→ 右', start: '开始 Start', select: '选择 Select', l: 'L 肩键', r: 'R 肩键' }
const padNames: Record<number, string> = { 0: 'A / ×', 1: 'B / ○', 2: 'X / □', 3: 'Y / △', 4: 'LB / L1', 5: 'RB / R1', 8: 'Select / Back', 9: 'Start', 12: '↑', 13: '↓', 14: '←', 15: '→' }
const keyLabel = (code: string) => code ? code.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→') : '未绑定'

function cancelEdit() {
  if (capturing.value) { capturing.value = null; return true }
  if (editingKey.value) { editingKey.value = null; return true }
  return false
}
function close() {
  if (props.busy || cancelEdit()) return
  show.value = false
}
function commitRename(state: Snapshot) {
  if (editingKey.value !== state.key) return
  if (!editingText.value.trim()) return
  editingKey.value = null
  emit('rename', state, editingText.value.trim())
}
function captureKey(event: KeyboardEvent) {
  if (!capturing.value) return false
  event.preventDefault(); event.stopImmediatePropagation()
  if (event.code !== 'Escape') {
    const map = props.settings.keymaps[player.value]
    for (const action of config.actions) if (map[action] === event.code) map[action] = ''
    map[capturing.value] = event.code
  }
  capturing.value = null
  return true
}
watch(capturing, value => {
  if (value) window.addEventListener('keydown', captureKey, true)
  else window.removeEventListener('keydown', captureKey, true)
}, { flush: 'sync' })
watch([show, tab, player], () => { capturing.value = null; editingKey.value = null })
watch([show, tab, () => props.current?.hash], () => { saveFilter.value = props.current ? 'current' : 'all'; saveQuery.value = '' })
watch(saveFilterOptions, options => { if (!options.some(option => option.value === saveFilter.value)) saveFilter.value = 'all' })
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
      <fieldset :id="`console-panel-${tab}`" class="player-settings-body" :class="{ 'player-settings-list': tab === 'saves' }" :disabled="busy" role="tabpanel" :aria-labelledby="`console-tab-${tab}`">
        <section v-if="tab === 'saves'" class="store-panel player-saves">
          <div class="store-tools">
            <div class="search-tools"><SButton :disabled="!current" @click="emit('save')">新建存档</SButton><SInput v-model:value="saveQuery" type="search" placeholder="搜索存档名、游戏名" aria-label="搜索存档" /></div>
            <RemoteSelect v-model="saveFilter" :options="saveFilterOptions" searchable aria-label="存档游戏范围" />
          </div>
          <div class="store-summary">显示 {{ filteredStates.length }} 条</div>
          <SHint class="load-hint">「新建存档」保留多份普通存档；Ctrl+S / F8 覆盖本游戏快速存档，F9 仅读取快速存档。跨游戏读档会切换到对应游戏，当前未保存进度不会保留。</SHint>
          <div class="save-list">
            <article v-for="state in filteredStates" :key="state.key" class="save-card console-state">
              <div class="save-main">
                <div class="save-title-row">
                  <STag size="small" :type="state.kind === 'quick' ? 'warning' : 'info'">{{ state.kind === 'quick' ? '快速' : '普通' }}</STag>
                  <SInput v-if="editingKey === state.key" v-model:value="editingText" class="rename-input" maxlength="80" aria-label="存档名称" @keydown.enter.prevent="commitRename(state)" @keydown.esc.prevent.stop="editingKey = null" @blur="commitRename(state)" />
                  <h3 v-else>{{ state.label }}</h3>
                  <SIconButton v-if="editingKey !== state.key" :size="44" title="重命名" aria-label="重命名" @click="editingKey = state.key; editingText = state.label">✎</SIconButton>
                </div>
                <p class="meta">{{ gameName(state) }} · {{ state.build.includes('-native-') ? '原生内核' : 'WASM 内核' }}</p>
                <p class="meta">{{ new Date(state.savedAt).toLocaleString() }}</p>
              </div>
              <div class="save-actions"><SButton class="btn primary" @click="emit('restore', state)">{{ current && current.hash !== state.hash ? '切换并读档' : '读档' }}</SButton><SButton class="btn" @click="emit('remove', state)">删除</SButton></div>
            </article>
            <SEmpty v-if="!filteredStates.length" :description="states.length ? '没有匹配的存档' : '还没有任何存档'" />
          </div>
        </section>
        <section v-else-if="tab === 'keys'" class="keys-page">
          <section class="keyboard-help"><h3>快捷键</h3><dl><dt><kbd>Esc</kbd></dt><dd>游戏中打开暂停菜单，再按一次继续游戏。</dd><dt><kbd>Ctrl+S / F8</kbd></dt><dd>保存本游戏快速存档。</dd><dt><kbd>F9</kbd></dt><dd>读取本游戏快速存档。</dd><dt><kbd>F11</kbd></dt><dd>全屏 / 窗口切换。</dd></dl></section>
          <div class="touch-layout-setting"><span>触屏按键布局</span><SButton @click="emit('editLayout')">编辑布局</SButton></div>
          <SHint>方向键可调整大小，每个动作按钮可独立移动、缩放或隐藏；横屏与竖屏分别保存。</SHint>
          <div class="player-switch"><SButton v-for="index in config.players" :key="index" :class="{ active: player === index - 1 }" @click="player = index - 1">玩家 {{ index }}</SButton></div>
          <SHint>键盘与标准手柄可同时操作。点击键盘列修改绑定，Esc 取消。手柄按连接顺序分配；同时按 L3 + R3 可暂停。{{ system === 'gba' ? '掌机当前支持单机游玩。' : '' }}</SHint>
          <div class="key-heading"><span>操作</span><span>键盘</span><span>手柄</span></div>
          <div v-for="action in config.actions" :key="action" class="arcade-key-row"><span>{{ actionNames[action] || action.toUpperCase() }}</span><SButton :class="{ active: capturing === action }" @click="capturing = action">{{ capturing === action ? '按下新按键…' : keyLabel(settings.keymaps[player][action]) }}</SButton><span>{{ padNames[PADMAP[action]] }}</span></div>
          <SButton @click="emit('resetKeys', player)">恢复当前玩家默认按键</SButton>
        </section>
        <section v-else-if="tab === 'display'" class="display-page">
          <label>画面平滑<SSwitch v-model:value="settings.smoothing" /></label>
          <label>宽高比<RemoteSelect v-model="settings.aspect" :options="[{ value: 'auto', label: '自动（跟随游戏）' }, { value: '4:3', label: '4:3' }, { value: '3:2', label: '3:2' }, { value: '10:9', label: '10:9' }, { value: '1:1', label: '1:1' }]" /></label>
        </section>
        <section v-else-if="tab === 'audio'" class="display-page"><label>静音<SSwitch v-model:value="settings.muted" /></label></section>
        <section v-else class="display-page">
          <label>触屏手柄<RemoteSelect v-model="settings.touch" :options="[{ value: 'auto', label: '默认（桌面隐藏，移动端显示）' }, { value: 'always', label: '显示' }, { value: 'never', label: '隐藏' }]" /></label>
          <div class="row"><span>本地游戏</span><SButton @click="emit('import')">导入游戏</SButton></div>
          <div v-if="current" class="row"><span>重新开始当前游戏</span><SButton @click="emit('restart')">重新开始</SButton></div>
          <details class="core-licenses"><summary>开源许可</summary><h4>{{ config.core }}</h4><pre>{{ system === 'gba' ? mgbaLicense : snesLicense }}</pre><h4>RetroArch</h4><pre>{{ retroarchLicense }}</pre></details>
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
