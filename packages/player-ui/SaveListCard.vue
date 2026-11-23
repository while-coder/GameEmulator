<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useCardActionMenu } from './useCardActionMenu'
import type { SaveListItem } from './saveList'

const props = defineProps<{ item: SaveListItem; image?: string; busy: boolean }>()
const emit = defineEmits<{ restore: []; rename: [label: string]; remove: [] }>()
const mode = ref<'menu' | 'rename' | 'delete'>('menu')
const label = ref('')
const input = ref<HTMLInputElement | null>(null)
const cancelDelete = ref<HTMLButtonElement | null>(null)
const { trigger, dialog, shown, position, contextMenu, closeMenu, closed, click, pointerDown, pointerMove, pointerUp,
  cancelPointer, cancelPress, keyDown, keyUp, padDown, padUp } = useCardActionMenu(() => props.busy, () => emit('restore'))

watch(shown, open => { if (!open) mode.value = 'menu' })
async function rename() {
  mode.value = 'rename'
  position.value = {}
  label.value = props.item.label
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
async function confirmDelete() {
  mode.value = 'delete'
  position.value = {}
  await nextTick()
  cancelDelete.value?.focus()
}
function saveName() {
  const value = label.value.trim()
  if (!value) return
  closeMenu()
  emit('rename', value)
}
function remove() {
  closeMenu()
  emit('remove')
}
function hideImage(event: Event) {
  (event.currentTarget as HTMLImageElement).hidden = true
}
</script>

<template>
  <article class="save-list-card">
    <div class="save-preview">
      <img v-if="image" :key="image" :src="image" :alt="item.label + '截图'" draggable="false" @error="hideImage">
      <span>暂无截图</span>
    </div>
    <div class="save-list-info">
      <h2>{{ item.label }}</h2>
      <p>{{ item.kind === 'quick' ? '快速存档' : '手动存档' }} · {{ new Date(item.savedAt).toLocaleString() }}</p>
      <p v-if="item.compatible === false">核心版本不兼容</p>
    </div>
    <button ref="trigger" class="save-card-trigger" type="button" data-nav-primary data-nav-hold
      :disabled="busy" :aria-label="`读档 ${item.label}；长按或右键打开存档菜单`" aria-haspopup="dialog" :aria-expanded="shown"
      @click="click" @contextmenu.prevent.stop="contextMenu"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
      @pointercancel="cancelPointer" @pointerleave="cancelPointer" @blur="cancelPress"
      @keydown="keyDown" @keyup="keyUp" @nav-confirm-start="padDown" @nav-confirm-end="padUp" @nav-confirm-cancel="cancelPress" />
  </article>
  <Teleport to="body">
    <dialog ref="dialog" class="save-card-menu" :style="position" aria-label="存档操作"
      @cancel.prevent="closeMenu" @close="closed" @click="event => { if (event.target === dialog) closeMenu() }">
      <template v-if="mode === 'menu'">
        <button type="button" @click="rename">重命名</button>
        <button type="button" class="delete-save" @click="confirmDelete">删除</button>
      </template>
      <form v-else-if="mode === 'rename'" class="save-card-operation" @submit.prevent="saveName">
        <label for="rename-save-input">存档名称</label>
        <input id="rename-save-input" ref="input" v-model="label" maxlength="80">
        <div>
          <button type="button" @click="closeMenu">取消</button>
          <button type="submit" :disabled="!label.trim()">保存名称</button>
        </div>
      </form>
      <div v-else class="save-card-operation">
        <p>删除「{{ item.label }}」？</p>
        <div>
          <button ref="cancelDelete" type="button" @click="closeMenu">取消</button>
          <button type="button" class="delete-save" @click="remove">确认删除</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.save-list-card { position: relative; overflow: hidden; background: #232427; border: 1px solid #404249; border-radius: 14px; }
.save-list-card:focus-within { outline: 2px solid #a9d2ff; outline-offset: 2px; }
.save-card-trigger { position: absolute; z-index: 2; inset: 0; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; touch-action: manipulation; -webkit-touch-callout: none; }
.save-card-trigger:disabled { cursor: default; }
@media (hover: hover) { .save-list-card:hover { border-color: #789cc2; } }
.save-preview { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; background: #101113; color: #a4a7af; }
.save-preview img { position: absolute; width: 100%; height: 100%; object-fit: contain; background: #101113; image-rendering: pixelated; }
.save-preview img:not([hidden]) + span { visibility: hidden; }
.save-list-info { padding: 14px; }
.save-list-info h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.save-list-info p { margin: 6px 0 0; color: #bdc0c7; overflow-wrap: anywhere; }
.save-card-menu { width: min(300px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 8px; border: 1px solid #566273; border-radius: 10px; background: #252a32; color: #e8eaed; color-scheme: dark; box-shadow: 0 12px 36px #0008; }
.save-card-menu::backdrop { background: #0005; }
.save-card-menu button { display: block; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.save-card-menu button:hover, .save-card-menu button:focus-visible { background: #35445a; }
.save-card-menu button:disabled { opacity: .5; cursor: default; }
.save-card-menu .delete-save { color: #ffb4b4; }
.save-card-operation { display: grid; gap: 12px; padding: 8px; }
.save-card-operation input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #777a81; border-radius: 6px; background: #191a1c; color: inherit; }
.save-card-operation p { margin: 0; overflow-wrap: anywhere; }
.save-card-operation > div { display: flex; gap: 8px; }
.save-card-operation button { width: auto; }
</style>
