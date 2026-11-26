<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GamePreview from '../../../player-ui/GamePreview.vue'
import { useRemoteNav } from '../../../player-ui/useRemoteNav'
import type { LobbyCard } from './lobbyGames'
import type { LobbyGame } from './useLobbyLibrary'

const props = defineProps<{ card: LobbyCard; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; play: [LobbyGame]; saves: [LobbyGame]; download: [LobbyGame]; remove: [LobbyGame] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const selectedKey = ref(props.card.launch.key)
const screenshotIndex = ref(0)
const selected = computed(() => props.card.versions.find(game => game.key === selectedKey.value) ?? props.card.launch)
const versionLabel = (game: LobbyGame) => game.details?.version ?? game.name
const sharedDescription = computed(() => props.card.base.groupDescription)
const gallery = computed(() => {
  const { groupScreenshots, screenshot } = props.card.base
  return groupScreenshots?.length ? groupScreenshots : screenshot ? [screenshot] : []
})
watch(() => selected.value.key, key => { selectedKey.value = key })
watch(() => gallery.value.length, length => { if (screenshotIndex.value >= length) screenshotIndex.value = 0 })
watch(() => props.busy, async busy => {
  if (busy) return
  await nextTick()
  if (dialog.value && !dialog.value.contains(document.activeElement)) {
    dialog.value.querySelector<HTMLElement>('[data-selected-version], .details-actions button')?.focus()
  }
})

function close() { if (!props.busy) emit('close') }
const { focusElement } = useRemoteNav({ container: dialog, active: computed(() => !props.busy), priority: 22, onBack: close })
onMounted(() => {
  dialog.value?.showModal()
  focusElement(dialog.value?.querySelector<HTMLElement>('[data-selected-version], .details-actions button') ?? null)
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="lobby-game-details" aria-labelledby="lobby-game-details-title" @cancel.prevent="close">
      <header class="details-header" data-nav-row>
        <div>
          <h2 id="lobby-game-details-title">{{ card.name }}</h2>
          <p>{{ [card.base.badge, card.base.genre, card.base.publisher].filter(Boolean).join(' · ') }}</p>
        </div>
        <button type="button" :disabled="busy" @click="close">关闭</button>
      </header>

      <div class="details-content">
        <section class="details-preview" aria-label="游戏截图">
          <GamePreview :key="gallery[screenshotIndex] || card.base.key" :game-key="card.base.key" :name="card.name"
            :system="card.base.badge" :screenshot="gallery[screenshotIndex]" />
          <div v-if="gallery.length > 1" class="details-gallery" data-nav-row>
            <button type="button" :disabled="busy || screenshotIndex === 0" @click="screenshotIndex--">上一张</button>
            <span aria-live="polite">{{ screenshotIndex + 1 }} / {{ gallery.length }}</span>
            <button type="button" :disabled="busy || screenshotIndex === gallery.length - 1" @click="screenshotIndex++">下一张</button>
          </div>
          <p v-if="card.base.groupId && gallery.length" class="details-note">共用截图</p>
          <p v-if="sharedDescription">{{ sharedDescription }}</p>
        </section>
        <section class="details-versions" :aria-label="card.versions.length > 1 ? '选择版本' : '版本详情'">
          <template v-if="card.versions.length > 1">
            <h3>选择版本</h3>
            <div v-for="game in card.versions" :key="game.key" class="details-version" data-nav-row>
              <button type="button" class="details-version-label" :aria-pressed="selected.key === game.key"
                :data-selected-version="selected.key === game.key ? '' : undefined" :disabled="busy" @click="selectedKey = game.key">
                {{ versionLabel(game) }}
                <small v-if="game.local">已下载</small>
                <small v-else-if="game.lastPlayedAt">曾游玩</small>
              </button>
              <button type="button" :disabled="busy" :aria-label="`开始游戏：${versionLabel(game)}`" @click="emit('play', game)">开始</button>
            </div>
          </template>
          <h3 v-else-if="selected.details?.version">{{ selected.details.version }}</h3>
          <p v-if="selected.tags?.length" class="details-note">{{ selected.tags.join(' · ') }}</p>
          <div class="details-actions" data-nav-row>
            <button v-if="card.versions.length === 1" type="button" :disabled="busy" @click="emit('play', selected)">开始游戏</button>
            <button type="button" :disabled="busy" @click="emit('saves', selected)">查看存档</button>
            <button v-if="selected.download" type="button" :disabled="busy" @click="emit('download', selected)">下载此版本</button>
            <button v-if="selected.removeCache" type="button" :disabled="busy" @click="emit('remove', selected)">移除下载</button>
            <a v-if="selected.details?.source_url" :href="selected.details.source_url" target="_blank" rel="noopener noreferrer">来源</a>
          </div>
        </section>
      </div>
      <p v-if="error" class="details-error" role="alert">{{ error }}</p>
    </dialog>
  </Teleport>
</template>

<style scoped>
.lobby-game-details {
  box-sizing: border-box; width: min(740px, calc(100% - 24px)); max-height: calc(100dvh - 24px);
  border: 1px solid #53647a; border-radius: 14px; padding: clamp(12px, 3vw, 24px);
  background: #1e2632; color: #edf3fc; color-scheme: dark; overflow: auto;
}
.lobby-game-details::backdrop { background: #090c14bb; }
.details-header { display: flex; align-items: start; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
.details-header h2 { margin: 0; font-size: 22px; overflow-wrap: anywhere; }
.details-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.details-preview :deep(.game-preview) { aspect-ratio: 4 / 3; border-radius: 8px; }
.details-preview :deep(.game-preview img) { object-fit: contain; }
.details-versions h3 { margin: 0 0 8px; font-size: 16px; overflow-wrap: anywhere; }
p { margin: 8px 0; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-line; }
.details-header p, .details-note, small, .details-gallery span { color: #b9c8db; font-size: 13px; }
.details-version { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; margin-bottom: 6px; }
.details-version-label { text-align: left; overflow-wrap: anywhere; }
.details-version-label small { display: block; }
.details-version-label[aria-pressed="true"] { border-color: #8aafe0; background: #293d56; }
.details-gallery, .details-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.details-gallery { justify-content: center; }
button, a {
  box-sizing: border-box; min-height: 40px; padding: 6px 11px; border: 1px solid #4c5d73;
  border-radius: 7px; background: #273447; color: inherit; font: inherit; font-size: 14px; cursor: pointer;
}
a { display: inline-flex; align-items: center; text-decoration: none; }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, a:focus-visible { outline: 2px solid #a9d2ff; outline-offset: 1px; }
.details-error { color: #ffb7b7; }
@media (max-width: 570px) { .details-content { grid-template-columns: 1fr; } }
</style>
