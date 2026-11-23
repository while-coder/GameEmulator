<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps<{ open: boolean; maxLength?: number }>()
const emit = defineEmits<{ open: [] }>()
const query = defineModel<string>({ required: true })
const action = ref<HTMLButtonElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const editing = ref(false)
const hint = '搜索游戏、厂商、标签，支持拼音'

watch(() => props.open, async () => {
  editing.value = false
  await nextTick()
  action.value?.focus({ preventScroll: true })
})

async function activate() {
  if (!props.open) {
    emit('open')
    return
  }
  editing.value = true
  await nextTick()
  input.value?.focus({ preventScroll: true })
}

function finishEditing() {
  editing.value = false
  void nextTick(() => action.value?.focus({ preventScroll: true }))
}

function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  finishEditing()
}

function onImeDismissed(event: Event) {
  if (!editing.value || document.activeElement !== input.value) return
  event.preventDefault()
  input.value?.blur()
  finishEditing()
}

onMounted(() => window.addEventListener('tv-text-input-dismissed', onImeDismissed, true))
onBeforeUnmount(() => window.removeEventListener('tv-text-input-dismissed', onImeDismissed, true))
</script>

<template>
  <button v-show="!editing" ref="action" type="button" class="library-search-control" @click="activate">
    {{ open ? (query ? `关键词 · ${query}` : '输入关键词') : '搜索游戏' }}
  </button>
  <input v-if="open" v-show="editing" ref="input" v-model="query" class="library-search-control"
    type="text" inputmode="search" enterkeyhint="search" :maxlength="maxLength" :placeholder="hint" :aria-label="hint"
    @blur="editing = false" @keydown.enter="onEnter" />
</template>

<style scoped>
.library-search-control {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: var(--library-control-height, 36px);
  padding: 0 10px;
  border: 1px solid #414751;
  border-radius: 6px;
  background: #23262c;
  color: inherit;
  font: inherit;
}
button.library-search-control {
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
</style>
