<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  loading: boolean
  hasGames: boolean
  hasCatalog: boolean
  hasDownloads: boolean
  failed: boolean
  partial?: boolean
  reason?: string
  disabled?: boolean
}>()
defineEmits<{ retry: [] }>()
const visible = computed(() => props.loading ? !props.hasGames : props.failed)
const title = computed(() => {
  if (props.loading) return '正在加载游戏目录…'
  if (props.partial) return '部分目录未能更新'
  return props.hasCatalog ? '目录暂时无法更新' : '暂时无法加载在线目录'
})
const description = computed(() => {
  if (props.loading) return '首次加载可能需要几秒钟'
  if (!props.failed) return ''
  const notes = [props.reason || '请稍后重试']
  if (props.hasCatalog) notes.push('已保留上次目录')
  else if (props.hasGames) notes.push('已保留本地游戏记录')
  if (props.hasDownloads) notes.push('已下载游戏仍可使用')
  return notes.join('，')
})
</script>

<template>
  <div v-if="visible" class="library-request-status" :class="{ warning: failed && !loading }"
    :role="failed && !loading && !hasGames ? 'alert' : 'status'">
    <span class="request-icon" aria-hidden="true">{{ loading ? '↻' : 'ⓘ' }}</span>
    <div class="request-copy"><span>{{ title }}</span><span v-if="description" class="request-description">{{ description }}</span></div>
    <button v-if="failed && !loading" type="button" :disabled="disabled" @click="$emit('retry')">重试</button>
  </div>
  <span v-else-if="loading" class="request-sr-only" role="status">正在刷新游戏库，当前列表仍可浏览</span>
</template>

<style scoped>
.library-request-status { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; margin: 0 4px 6px; padding: 6px 8px; border-radius: 6px; background: #242b35; color: #b2c4dc; font-size: 12px; line-height: 1.5; }
.library-request-status.warning { background: #302a20; color: #e1c187; }
.request-icon { flex-shrink: 0; font-size: 15px; }
.request-copy { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; }
.request-description { color: #a8adb5; overflow-wrap: anywhere; }
.library-request-status button { flex-shrink: 0; min-height: 32px; padding: 4px 10px; border: 1px solid #79633f; border-radius: 5px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.library-request-status button:disabled { cursor: default; opacity: .5; }
.request-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
