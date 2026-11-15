<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRemoteNav } from './useRemoteNav'

const props = defineProps<{ action?: 'return' | 'exit' }>()
const exiting = computed(() => props.action === 'exit')
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ confirm: [] }>()
const panel = ref<HTMLElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
let disposed = false
watch(show, async visible => {
  await nextTick()
  if (disposed) return
  if (visible && !dialog.value?.open) dialog.value?.showModal()
  else if (!visible) dialog.value?.close()
})
onBeforeUnmount(() => { disposed = true; dialog.value?.close() })
function cancel() { show.value = false }
function confirm() { show.value = false; emit('confirm') }
useRemoteNav({ container: panel, active: computed(() => show.value), autoFocus: true, priority: 30, onBack: cancel })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="leave-dialog" aria-labelledby="leave-dialog-title" @cancel.prevent="cancel">
      <div ref="panel">
        <h2 id="leave-dialog-title">{{ exiting ? '退出应用' : '返回模拟器列表' }}</h2>
        <p>{{ exiting ? '是否退出 App？' : '是否返回模拟器列表？' }}</p>
        <div class="leave-actions">
          <button type="button" autofocus @click="cancel">取消</button>
          <button type="button" class="confirm" @click="confirm">{{ exiting ? '退出' : '确认返回' }}</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
p { margin: 0 0 24px; }
.leave-dialog { width: min(400px, calc(100vw - 32px)); padding: 24px; border: 1px solid #606060; border-radius: 16px; background: #242424; color: #e8e8e8; }
.leave-dialog::backdrop { background: rgb(0 0 0 / .65); }
h2 { margin: 0 0 16px; font-size: 20px; }
.leave-actions { display: flex; justify-content: flex-end; gap: 12px; }
button { min-height: 44px; padding: 10px 20px; border: 1px solid #606060; border-radius: 8px; background: #333; color: #fff; font: inherit; cursor: pointer; }
button.confirm { border-color: #d45359; background: #a6353d; }
button:focus-visible { outline: 3px solid #82b1ff; outline-offset: 3px; }
</style>
