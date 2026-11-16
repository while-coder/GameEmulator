<script setup lang="ts">
import { nextTick, ref } from 'vue'
defineProps<{ panelId: string; counts: Record<'online' | 'played' | 'favorites', number> }>()
const model = defineModel<'online' | 'played' | 'favorites'>({ default: 'online' })
const tabs = [{ id: 'online', label: '在线游戏库' }, { id: 'played', label: '我的游戏' }, { id: 'favorites', label: '收藏' }] as const
const root = ref<HTMLElement | null>(null)
async function navigate(event: KeyboardEvent) {
  const index = tabs.findIndex(tab => tab.id === model.value)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault(); event.stopPropagation()
  model.value = tabs[next].id
  await nextTick()
  root.value?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>

<template>
  <nav ref="root" class="library-tabs" role="tablist" aria-label="游戏库分类" data-nav-row @keydown="navigate">
    <button v-for="tab in tabs" :id="`${panelId}-${tab.id}`" :key="tab.id" type="button" role="tab"
      :aria-selected="model === tab.id" :aria-controls="panelId" :tabindex="model === tab.id ? 0 : -1" @click="model = tab.id">
      {{ tab.label }} <span>{{ counts[tab.id] }}</span>
    </button>
  </nav>
</template>
