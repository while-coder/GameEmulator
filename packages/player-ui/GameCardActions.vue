<script setup lang="ts">
import { useCardActionMenu } from './useCardActionMenu'

const props = defineProps<{ name: string; detail: string; disabled: boolean; busy: boolean; canRemove: boolean; canDownload: boolean; favorite: boolean; detailsLabel?: string }>()
const emit = defineEmits<{ play: []; remove: []; download: []; favorite: []; saves: []; details: [] }>()
const { trigger, dialog, shown, position, contextMenu, closeMenu, closed, click, pointerDown, pointerMove, pointerUp,
  cancelPointer, cancelPress, keyDown, keyUp, padDown, padUp } = useCardActionMenu(() => props.disabled, () => emit('play'))

function choose(action: 'play' | 'remove' | 'download' | 'favorite' | 'saves' | 'details') {
  closeMenu()
  if (!props.disabled) {
    trigger.value?.focus({ preventScroll: true })
    if (action === 'play') emit('play')
    else if (action === 'remove' && props.canRemove) emit('remove')
    else if (action === 'download' && props.canDownload) emit('download')
    else if (action === 'favorite') emit('favorite')
    else if (action === 'details') emit('details')
    else if (action === 'saves') emit('saves')
  }
}
</script>

<template>
  <button ref="trigger" class="game-launch" data-nav-primary data-nav-hold
    :disabled="disabled" :aria-label="`开始 ${name}；长按或右键打开操作菜单`"
    :title="`${name} · ${detail}\n右键 / 长按 / 菜单键：游戏操作`" :aria-busy="busy"
    aria-haspopup="dialog" :aria-expanded="shown"
    @click="click" @contextmenu.prevent.stop="contextMenu"
    @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
    @pointercancel="cancelPointer" @pointerleave="cancelPointer" @blur="cancelPress"
    @keydown="keyDown" @keyup="keyUp" @nav-confirm-start="padDown" @nav-confirm-end="padUp" @nav-confirm-cancel="cancelPress" />
  <Teleport to="body">
    <dialog ref="dialog" class="game-card-menu" :style="position" aria-label="游戏操作"
      @cancel.prevent="closeMenu" @close="closed" @click="event => { if (event.target === dialog) closeMenu() }">
      <h2>{{ name }}</h2>
      <button type="button" @click="choose('play')">开始游戏</button>
      <button v-if="detailsLabel" type="button" @click="choose('details')">{{ detailsLabel }}</button>
      <button v-if="canDownload" type="button" @click="choose('download')">下载游戏</button>
      <button type="button" @click="choose('saves')">查看存档</button>
      <button type="button" :aria-pressed="favorite" @click="choose('favorite')">{{ favorite ? '取消收藏' : '收藏游戏' }}</button>
      <button v-if="canRemove" type="button" class="remove-cache" @click="choose('remove')">移除下载缓存</button>
      <button type="button" class="cancel-menu" @click="closeMenu">取消</button>
    </dialog>
  </Teleport>
</template>

<style scoped>
.game-card-menu { width: min(300px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 8px; border: 1px solid #566273; border-radius: 10px; background: #252a32; color: #e8eaed; box-shadow: 0 12px 36px #0008; }
.game-card-menu::backdrop { background: #0005; }
h2 { margin: 0; padding: 8px; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.game-card-menu button { display: block; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.game-card-menu button:hover { background: #35445a; }
.game-card-menu .remove-cache { color: #ffb4b4; }
.game-card-menu .cancel-menu { border-top: 1px solid #414751; border-radius: 0 0 6px 6px; color: #b6bfcc; }
</style>
