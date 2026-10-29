<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Same flow as ClipRoam: install permission -> static manifest -> APK -> system installer.
type Status = 'idle' | 'checking' | 'permission' | 'latest' | 'available' | 'downloading' | 'installer' | 'error'
interface UpdateInfo { version: string; notes: string; url: string }
const emit = defineEmits<{ modalChange: [visible: boolean] }>()
const status = ref<Status>('idle')
const update = ref<UpdateInfo | null>(null)
const message = ref('')
const downloaded = ref(0)
const total = ref<number | null>(null)
const dialog = ref<HTMLDialogElement>()
const visible = computed(() => !['idle', 'checking'].includes(status.value))
const busy = computed(() => ['checking', 'downloading'].includes(status.value))
const percent = computed(() => total.value ? Math.min(100, Math.round(downloaded.value / total.value * 100)) : undefined)
let timer: ReturnType<typeof setTimeout> | undefined
let waitingForPermission = false
let disposed = false
let downloadPath = ''

watch(visible, async (value) => {
  emit('modalChange', value)
  await nextTick()
  if (disposed) return
  if (value && !dialog.value?.open) dialog.value?.showModal()
  else if (!value) dialog.value?.close()
})

async function check(silent = false) {
  if (busy.value) return
  clearTimeout(timer)
  status.value = 'checking'
  message.value = ''
  update.value = null
  downloadPath = ''
  try {
    if (!await invoke<boolean>('native_update_permission_status')) {
      status.value = silent ? 'idle' : 'permission'
      return
    }
    update.value = await invoke<UpdateInfo | null>('native_update_check')
    status.value = update.value ? 'available' : silent ? 'idle' : 'latest'
  } catch (error) {
    message.value = String(error)
    status.value = silent ? 'idle' : 'error'
  }
}

async function requestPermission() {
  try {
    waitingForPermission = true
    await invoke('native_update_request_permission')
  } catch (error) {
    waitingForPermission = false
    message.value = String(error)
    status.value = 'error'
  }
}

async function resume() {
  if (!waitingForPermission || document.hidden) return
  // Consume the flag before awaiting: focus and visibilitychange can both fire.
  waitingForPermission = false
  await check()
}

async function install() {
  if (!update.value || busy.value) return
  clearTimeout(timer)
  status.value = 'downloading'
  message.value = ''
  let unlisten: (() => void) | undefined
  try {
    // Permission may have been revoked since checking for updates.
    if (!await invoke<boolean>('native_update_permission_status')) {
      status.value = 'permission'
      return
    }
    if (!downloadPath) {
      downloaded.value = 0
      total.value = null
      unlisten = await listen<{ downloaded: number; total: number | null }>('game-emulator://update-progress', ({ payload }) => {
        downloaded.value = payload.downloaded
        total.value = payload.total
      })
      downloadPath = await invoke<string>('native_update_download', { url: update.value.url, version: update.value.version })
    }
    await invoke('native_update_install', { path: downloadPath })
    status.value = 'installer'
  } catch (error) {
    message.value = String(error)
    status.value = 'error'
  } finally {
    unlisten?.()
  }
}

function dismiss() {
  if (status.value !== 'downloading') status.value = 'idle'
}
function handleBack() {
  if (!visible.value) return false
  dismiss()
  return true
}
function formatSize(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB` }

onMounted(() => {
  timer = setTimeout(() => void check(true), 5000)
  window.addEventListener('focus', resume)
  document.addEventListener('visibilitychange', resume)
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  window.removeEventListener('focus', resume)
  document.removeEventListener('visibilitychange', resume)
  dialog.value?.close()
})
defineExpose({ handleBack })
</script>

<template>
  <button class="update-check" type="button" :disabled="busy" @click="check()">{{ status === 'checking' ? '正在检查更新…' : '检查更新' }}</button>
  <Teleport to="body">
    <dialog ref="dialog" class="android-update" aria-labelledby="android-update-title" @cancel.prevent="dismiss" @keydown.stop>
      <template v-if="status === 'permission'">
        <h2 id="android-update-title">允许应用内更新</h2>
        <p>请在系统设置中允许 GameEmulator 安装未知应用，返回后将继续检查更新。</p>
        <div class="actions"><button @click="dismiss">稍后</button><button class="primary" @click="requestPermission">前往授权</button></div>
      </template>
      <template v-else-if="status === 'available'">
        <h2 id="android-update-title">发现新版本 {{ update?.version }}</h2>
        <p v-if="update?.notes" class="notes">{{ update.notes }}</p>
        <div class="actions"><button @click="dismiss">稍后</button><button class="primary" @click="install">现在更新</button></div>
      </template>
      <template v-else-if="status === 'downloading'">
        <h2 id="android-update-title">正在下载更新</h2>
        <progress aria-label="更新下载进度" :value="percent" max="100" />
        <p role="status">{{ formatSize(downloaded) }}<template v-if="total"> / {{ formatSize(total) }}（{{ percent }}%）</template></p>
      </template>
      <template v-else-if="status === 'installer'">
        <h2 id="android-update-title">安装包已就绪</h2>
        <p>请在系统安装器中确认安装。如果取消了安装，可以再次打开安装器。</p>
        <div class="actions"><button @click="dismiss">关闭</button><button class="primary" @click="install">再次安装</button></div>
      </template>
      <template v-else-if="status === 'latest'">
        <h2 id="android-update-title">当前已是最新版本</h2>
        <div class="actions"><button class="primary" @click="dismiss">确定</button></div>
      </template>
      <template v-else-if="status === 'error'">
        <h2 id="android-update-title">更新失败</h2>
        <p class="error" role="alert">{{ message }}</p>
        <div class="actions"><button @click="dismiss">关闭</button><button class="primary" @click="update ? install() : check()">重试</button></div>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.update-check { margin: 12px 0 0; display: block; }
button { min-height: 44px; padding: 10px 16px; border: 1px solid #606060; border-radius: 8px; background: #303030; color: #e8e8e8; font: inherit; cursor: pointer; }
button:disabled { opacity: .6; cursor: wait; }
button:focus-visible { outline: 3px solid #82b1ff; outline-offset: 3px; }
.android-update { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 64px); padding: 24px; border: 1px solid #606060; border-radius: 16px; background: #242424; color: #e8e8e8; overflow: auto; }
.android-update::backdrop { background: rgb(0 0 0 / .65); }
h2 { font-size: 20px; margin: 0 0 16px; }
p { line-height: 1.6; margin: 12px 0; overflow-wrap: anywhere; }
.notes { white-space: pre-wrap; max-height: 36dvh; overflow: auto; }
.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.primary { background: #a6353d; border-color: #d45359; color: #fff; }
.error { color: #ffb4b4; }
progress { width: 100%; accent-color: #d45359; height: 12px; }
</style>
