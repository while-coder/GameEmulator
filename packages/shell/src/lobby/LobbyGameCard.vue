<script setup lang="ts">
import GameCardActions from '../../../player-ui/GameCardActions.vue'
import GamePreview from '../../../player-ui/GamePreview.vue'
import type { LobbyGame } from './useLobbyLibrary'

defineProps<{ game: LobbyGame; focusId: string; disabled: boolean }>()
defineEmits<{ play: []; saves: []; download: []; remove: [] }>()
</script>

<template>
  <article class="game-card" data-nav-cell :data-lobby-focus="focusId">
    <GameCardActions :name="game.name" :detail="game.badge" :disabled="disabled" :busy="false"
      :can-remove="!!game.removeCache" :can-download="!!game.download" :favorite="game.favorite"
      @play="$emit('play')" @saves="$emit('saves')" @favorite="game.toggleFavorite"
      @download="$emit('download')" @remove="$emit('remove')" />
    <GamePreview :game-key="game.key" :name="game.name" :system="game.badge" :screenshot="game.screenshot">
      <span v-if="game.local" class="local-mark">本地</span>
    </GamePreview>
    <div class="card-caption">
      <h3>{{ game.name }}</h3>
      <span v-if="game.favorite" class="favorite-mark" aria-label="已收藏">★</span>
    </div>
  </article>
</template>

<style scoped>
.game-card { min-width: 0; padding: 5px; border: 1px solid #3c4656; border-radius: 10px; background: #212833; }
.game-card:focus-within { border-color: #8aafe0; background: #29384b; }
.game-card :deep(.game-preview) { aspect-ratio: var(--lobby-card-preview-ratio, 16 / 9); border-radius: 6px; }
.game-card :deep(.preview-placeholder) { gap: 5px; font-size: 11px; }
.game-card :deep(.preview-placeholder svg) { width: 38px; height: 25px; }
.card-caption { display: flex; align-items: baseline; gap: 6px; padding: 6px 4px 3px; }
.card-caption h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--lobby-card-title-lines, 1);
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: var(--lobby-card-title, clamp(12px, 1.35vw, 18px));
  line-height: 1.35;
}
.favorite-mark { color: #f2c865; }
.local-mark { padding: 2px 5px; border-radius: 4px; background: #152b22e6; color: #b1edd0; font-size: 10px; }
</style>
