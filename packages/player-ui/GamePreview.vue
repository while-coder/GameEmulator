<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import screenshots from './data/game-screenshots.json'

const props = defineProps<{ gameKey: string; name: string; system: string; screenshot?: string }>()
const playlists: Record<string, string> = {
  nes: 'Nintendo - Nintendo Entertainment System',
  arcade: 'FBNeo - Arcade Games',
}
const source = computed(() => {
  if (props.screenshot) return props.screenshot
  const match = (screenshots as Record<string, string>)[props.gameKey.toLowerCase()]
  if (!match) return ''
  const slash = match.indexOf('/')
  return `https://thumbnails.libretro.com/${encodeURIComponent(playlists[match.slice(0, slash)])}/Named_Snaps/${encodeURIComponent(match.slice(slash + 1))}`
})
const loaded = ref(false)
const failed = ref(false)
watch(source, () => { loaded.value = false; failed.value = false })
</script>

<template>
  <div class="game-preview">
    <div v-if="!loaded || failed" class="preview-placeholder" aria-hidden="true">
      <svg viewBox="0 0 80 52" fill="none"><path d="M24 10h32c6 0 10 5 12 12l5 17c2 8-6 12-11 6l-8-8H26l-8 8C13 51 5 47 7 39l5-17c2-7 6-12 12-12Z" stroke="currentColor" stroke-width="3"/><path d="M24 19v15m-7-7h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="53" cy="23" r="3" fill="currentColor"/><circle cx="61" cy="30" r="3" fill="currentColor"/></svg>
      <span>{{ source && !failed ? '正在加载预览' : '暂无截图' }}</span>
    </div>
    <img v-if="source && !failed" :src="source" :alt="`${name} 游戏截图`" :class="{ loaded }" loading="lazy" decoding="async" referrerpolicy="no-referrer" @load="loaded = true" @error="failed = true" />
    <span class="preview-system">{{ system }}</span>
    <div class="preview-status"><slot /></div>
  </div>
</template>

<style scoped>
.game-preview { position: relative; flex: 0 0 auto; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; background: #14181e; border-radius: 9px; }
.game-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; opacity: 0; }
.game-preview img.loaded { opacity: 1; }
.preview-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #72839a; background: #202832; }
.preview-placeholder svg { width: 72px; height: 48px; }
.preview-placeholder > span { font-size: 12px; color: #929faf; }
.preview-system { position: absolute; top: 10px; left: 10px; padding: 4px 7px; border: 1px solid #ffffff1a; border-radius: 5px; background: #151a23d9; color: #d6e1ee; font-size: 10px; font-weight: 600; letter-spacing: .06em; }
.preview-status { position: absolute; right: 10px; top: 10px; }
@media (max-width: 700px) { .preview-system { top: 7px; left: 7px; font-size: 9px; } .preview-status { top: 7px; right: 7px; } }
</style>
