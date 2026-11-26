<script setup lang="ts">
import GameCardActions from '../../../player-ui/GameCardActions.vue'
import GamePreview from '../../../player-ui/GamePreview.vue'
import type { LobbyCard } from './lobbyGames'

defineProps<{ card: LobbyCard; focusId: string; disabled: boolean; mine: boolean }>()
defineEmits<{ play: []; saves: []; download: []; remove: []; details: [] }>()
</script>

<template>
  <article class="game-card" data-nav-cell :data-lobby-focus="focusId">
    <GameCardActions :name="card.name" :detail="card.launch.details?.version || card.base.badge" :disabled="disabled" :busy="false"
      :can-remove="card.versions.length === 1 && !!card.launch.removeCache" :can-download="card.versions.length === 1 && !!card.launch.download"
      :favorite="card.launch.favorite"
      :details-label="card.versions.length > 1 ? '选择版本' : card.base.system === 'nes' || card.base.details ? '游戏详情' : undefined"
      @play="$emit('play')" @saves="$emit('saves')" @favorite="card.launch.toggleFavorite"
      @download="$emit('download')" @remove="$emit('remove')" @details="$emit('details')" />
    <GamePreview :game-key="card.base.key" :name="card.name" :system="card.base.badge"
      :screenshot="card.base.groupScreenshots?.[0] ?? card.base.screenshot">
      <span v-if="card.localCount && !(mine && card.base.groupId)" class="local-mark">本地</span>
    </GamePreview>
    <div class="card-caption">
      <h3>{{ card.name }}</h3>
      <span v-if="card.versions.some(version => version.favorite)" class="favorite-mark" aria-label="已收藏">★</span>
    </div>
    <button v-if="card.versions.length > 1 || (mine && card.base.groupId && card.localCount)"
      class="version-picker" type="button" :disabled="disabled" aria-haspopup="dialog" @click="$emit('details')">
      {{ mine && card.localCount ? `已下载 ${card.localCount} 个版本` : `${card.versions.length} 个版本` }} ▾
    </button>
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
.version-picker {
  position: relative; z-index: 2; margin: 0 4px 3px; padding: 3px 7px; min-height: 28px;
  max-width: calc(100% - 8px); border: 1px solid #4e6786; border-radius: 5px;
  background: #202f44; color: #c4dcfa; font: inherit; font-size: 11px; cursor: pointer;
}
.version-picker:focus-visible { outline: 2px solid #a9d2ff; outline-offset: 1px; }
</style>
