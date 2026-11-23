<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRemoteNav } from './useRemoteNav'
import SaveListCard from './SaveListCard.vue'
import type { SaveListItem } from './saveList'

const props = defineProps<{ gameName?: string | null; load: () => Promise<SaveListItem[]>; create?: () => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLDialogElement | null>(null)
const items = shallowRef<(SaveListItem & { image?: string })[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
let disposed = false
let pressedBlank = false

function revokeImages() {
  for (const item of items.value) if (item.image) URL.revokeObjectURL(item.image)
}
async function refresh() {
  const list = await props.load()
  if (disposed) return
  revokeImages()
  items.value = list.sort((a, b) => b.savedAt - a.savedAt).map(item => ({
    ...item,
    image: item.preview?.size ? URL.createObjectURL(item.preview) : undefined,
  }))
}
async function action(run: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await run() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}
function back() {
  const menu = document.querySelector<HTMLDialogElement>('.save-card-menu[open]')
  if (menu) { menu.close(); return }
  if (!busy.value || loading.value) emit('close')
}
function isBlank(target: EventTarget | null) {
  return target instanceof Element && !target.closest('button, .save-list-card, h1, p')
}
function closeOnBlank(event: MouseEvent) {
  if ((pressedBlank || event.detail === 0) && isBlank(event.target)) back()
  pressedBlank = false
}
function restore(item: SaveListItem) {
  void action(async () => {
    if (item.compatible === false) throw new Error('此存档属于其他核心版本，无法读取')
    await item.restore()
  })
}
function rename(item: SaveListItem, label: string) {
  void action(async () => { await item.rename(label); await refresh() })
}
function remove(item: SaveListItem) {
  void action(async () => { await item.remove(); await refresh() })
}
function createSave() {
  if (props.create) void action(async () => { await props.create?.(); await refresh() })
}
const { focusFirst } = useRemoteNav({ container: panel, active: computed(() => !!panel.value), autoFocus: true, priority: 20, onBack: back })
onMounted(async () => {
  panel.value?.showModal()
  await action(refresh)
  loading.value = false
  await nextTick()
  if (panel.value && document.activeElement === panel.value) focusFirst()
})
onBeforeUnmount(() => { disposed = true; panel.value?.close(); revokeImages() })
defineExpose({ back })
</script>

<template>
  <Teleport to="body">
    <dialog ref="panel" class="player-save-list" aria-labelledby="player-save-title"
      @cancel.prevent="back" @pointerdown="pressedBlank = isBlank($event.target)" @click="closeOnBlank">
      <header class="save-list-header">
        <div class="save-list-heading">
          <h1 id="player-save-title">游戏存档</h1>
          <p v-if="gameName" :title="gameName">{{ gameName }}</p>
        </div>
        <button type="button" v-if="create" :disabled="busy" @click="createSave">新建存档</button>
      </header>
      <p v-if="error" class="save-list-error" role="alert">{{ error }}</p>
      <p v-if="loading" class="save-list-empty" role="status">正在读取存档…</p>
      <p v-else-if="!items.length && !error" class="save-list-empty">这个游戏还没有存档</p>
      <div v-else class="save-list-grid">
        <SaveListCard v-for="item in items" :key="item.key" :item="item" :image="item.image" :busy="busy"
          @restore="restore(item)" @rename="label => rename(item, label)" @remove="remove(item)" />
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.player-save-list { position: fixed; inset: 0; width: min(960px, calc(100% - 32px)); height: fit-content; min-height: min(320px, calc(100dvh - 32px)); max-height: calc(100dvh - 32px); box-sizing: border-box; margin: auto; border: 1px solid #555a65; border-radius: 16px; padding: clamp(16px, 3vw, 32px); background: #191a1c; color: #f0f0f1; color-scheme: dark; overflow: auto; }
.player-save-list::backdrop { background: #090c14aa; }
.save-list-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.save-list-heading { display: flex; align-items: baseline; gap: 10px; flex: 1; min-width: 0; }
.save-list-header button { flex-shrink: 0; min-height: 44px; padding: 6px 12px; border: 1px solid #575b63; border-radius: 8px; background: #30343b; color: inherit; font: inherit; cursor: pointer; }
.save-list-header button:disabled { opacity: .5; cursor: default; }
.save-list-header button:focus-visible, :global(.tv-nav) .save-list-header button:focus { outline: 2px solid #a9d2ff; outline-offset: 2px; }
.save-list-heading h1 { flex-shrink: 0; margin: 0; font-size: clamp(18px, 2.2vw, 22px); }
.save-list-heading p { min-width: 0; margin: 0; color: #bdc0c7; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.save-list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 16px; }
.save-list-error { color: #ffb7b7; }
.save-list-empty { color: #bdc0c7; margin: 48px 0; text-align: center; }
</style>
