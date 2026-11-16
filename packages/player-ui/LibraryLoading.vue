<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRemoteNav } from './useRemoteNav'

const props = defineProps<{
  name: string
  action: 'play' | 'download'
  message?: string
  progress?: { received: number; total: number | null; label?: string } | null
  cancelling: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const previousFocus = document.activeElement
const ratio = computed(() => props.progress?.total && props.progress.total > 0
  ? Math.min(1, props.progress.received / props.progress.total) : null)
const title = computed(() => props.cancelling ? '正在取消…' : props.message || (props.action === 'download' ? '正在下载游戏…' : '正在准备游戏…'))
function cancel() { if (!props.cancelling) emit('cancel') }
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => {
  dialog.value?.close()
  void nextTick(() => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }) })
})
useRemoteNav({ container: dialog, active: computed(() => true), autoFocus: true, priority: 40, onBack: cancel })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="library-loading" aria-label="游戏加载" aria-describedby="library-loading-title" @cancel.prevent="cancel">
      <div class="loading-content">
        <span class="loading-spinner" aria-hidden="true"></span>
        <h2 id="library-loading-title" role="status">{{ title }}</h2>
        <p class="loading-game">{{ name }}</p>
        <div class="loading-progress">
          <progress :value="ratio ?? undefined" :max="1" aria-label="下载进度"></progress>
          <p v-if="progress" class="loading-detail">
            <span v-if="progress.label">{{ progress.label }} · </span>
            {{ ratio === null ? `${(progress.received / 1024 / 1024).toFixed(1)} MB` : `${Math.floor(ratio * 100)}%` }}
          </p>
        </div>
        <button type="button" autofocus :disabled="cancelling" @click="cancel">{{ cancelling ? '正在取消…' : '取消' }}</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.library-loading { box-sizing: border-box; position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); border: 0; background: transparent; color: #e8eaed; color-scheme: dark; }
.library-loading[open] { display: grid; place-items: center; }
.library-loading::backdrop { background: rgb(9 12 18 / .48); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.loading-content { box-sizing: border-box; width: min(100%, 360px); padding: 28px; border: 1px solid rgb(170 193 225 / .18); border-radius: 16px; background: rgb(30 35 44 / .9); box-shadow: 0 16px 56px rgb(0 0 0 / .3), inset 0 1px 0 rgb(255 255 255 / .04); text-align: center; }
.loading-spinner { display: inline-block; width: 28px; height: 28px; border: 2px solid #3c4655; border-top-color: #9fc4f4; border-radius: 50%; animation: loading-spin 1s linear infinite; }
h2 { margin: 16px 0 8px; font-size: 18px; font-weight: 600; }
.loading-game { margin: 0; color: #b9c6d8; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.loading-progress { margin: 22px 0; }
progress { display: block; width: 100%; height: 6px; accent-color: #9fc4f4; }
.loading-detail { min-height: 1.5em; margin: 10px 0 0; font-size: 13px; color: #a9b3c1; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
button { min-width: 104px; min-height: 44px; padding: 10px 24px; border: 1px solid rgb(164 185 214 / .28); border-radius: 8px; background: rgb(147 174 211 / .08); color: #d4deec; font: inherit; font-size: 14px; cursor: pointer; }
button:hover:not(:disabled) { background: rgb(147 174 211 / .16); border-color: #7895ba; }
button:focus-visible { outline: 3px solid #9fc4f4; outline-offset: 4px; }
button:disabled { opacity: .6; cursor: wait; }
@keyframes loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading-spinner { animation: none; } }
@media (orientation: landscape) and (max-height: 420px) { .loading-content { padding: 18px 24px; } h2 { margin-top: 10px; } .loading-progress { margin-block: 14px; } .loading-spinner { width: 24px; height: 24px; } }
</style>
