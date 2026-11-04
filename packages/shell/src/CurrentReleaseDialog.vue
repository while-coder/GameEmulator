<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import changelog from '../../../CHANGELOG.md?raw'
import { releaseNotesForVersion } from './releaseNotes'

const props = defineProps<{ enabled: boolean; version: string }>()
const emit = defineEmits<{ modalChange: [visible: boolean] }>()
const storageKey = 'game-emulator.version'
const dismissed = ref(false)
const ready = ref(false)
const dialog = ref<HTMLDialogElement>()
const notes = computed(() => releaseNotesForVersion(changelog, props.version))
const html = computed(() => DOMPurify.sanitize(marked.parse(notes.value, { async: false })))
const visible = computed(() => ready.value && props.enabled && !dismissed.value && Boolean(notes.value))
let disposed = false

function readDisplayRecord() {
  try {
    dismissed.value = localStorage.getItem(storageKey) === props.version
  } catch (error) {
    dismissed.value = false
    console.warn('[updater] 无法读取版本内容展示记录', error)
  }
}
onMounted(() => {
  readDisplayRecord()
  ready.value = true
})
watch(() => props.version, readDisplayRecord)

watch(visible, async value => {
  emit('modalChange', value)
  await nextTick()
  if (disposed) return
  if (value && !dialog.value?.open) dialog.value?.showModal()
  else if (!value) dialog.value?.close()
})

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(storageKey, props.version)
  } catch (error) {
    console.warn('[updater] 无法保存版本内容展示记录', error)
  }
}

defineExpose({ handleBack: () => {
  if (!visible.value) return false
  dismiss()
  return true
} })
onBeforeUnmount(() => {
  disposed = true
  dialog.value?.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="current-release" aria-labelledby="current-release-title" @cancel.prevent="dismiss" @keydown.stop>
      <h2 id="current-release-title">本版本更新内容 <span>v{{ version }}</span></h2>
      <div class="release-notes" v-html="html" />
      <div class="actions"><button type="button" autofocus @click="dismiss">知道了</button></div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.current-release { width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 64px); padding: 24px; overflow: auto; border: 1px solid #606060; border-radius: 16px; background: #242424; color: #e8e8e8; }
.current-release::backdrop { background: rgb(0 0 0 / .65); }
h2 { margin: 0 0 16px; font-size: 20px; }
h2 span { color: #f0b3b6; white-space: nowrap; }
.release-notes { max-height: 55dvh; padding: 14px 16px; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; border: 1px solid #404040; border-radius: 8px; background: #1c1e21; font-size: 14px; line-height: 1.7; }
.release-notes :deep(h3) { font-size: 15px; margin: 16px 0 8px; }
.release-notes :deep(> :first-child) { margin-top: 0; }
.release-notes :deep(> :last-child) { margin-bottom: 0; }
.release-notes :deep(ul) { padding-left: 20px; }
.release-notes :deep(li + li) { margin-top: 6px; }
.release-notes :deep(a) { color: #f0b3b6; }
.release-notes :deep(img) { max-width: 100%; }
.actions { display: flex; justify-content: flex-end; margin-top: 20px; }
button { min-height: 44px; padding: 10px 20px; border: 1px solid #d45359; border-radius: 8px; background: #a6353d; color: #fff; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid #82b1ff; outline-offset: 3px; }
</style>
