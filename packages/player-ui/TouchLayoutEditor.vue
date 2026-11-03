<script setup lang="ts">
defineProps<{ controls: { id: string; label: string }[]; selected: string; scale: number; hidden: boolean }>()
const emit = defineEmits<{ select: [id: string]; resize: [scale: number]; toggle: [] }>()
</script>

<template>
  <div class="touch-layout-editor" data-layout-editor @pointerdown.stop @click.stop>
    <label>控件
      <select :value="selected" @change="emit('select', ($event.target as HTMLSelectElement).value)">
        <option v-for="control in controls" :key="control.id" :value="control.id">{{ control.label }}</option>
      </select>
    </label>
    <label>大小 {{ Math.round(scale * 100) }}%
      <input type="range" min="0.75" max="1.75" step="0.05" :value="scale" @input="emit('resize', Number(($event.target as HTMLInputElement).value))" />
    </label>
    <button v-if="selected !== 'dpad'" type="button" :aria-pressed="hidden" @click="emit('toggle')">{{ hidden ? '显示按钮' : '隐藏按钮' }}</button>
  </div>
</template>

<style scoped>
.touch-layout-editor { position: absolute; z-index: 20; top: 0; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; width: max-content; max-width: min(calc(100% - 16px), calc(100vw - 32px)); padding: 8px; border: 1px solid #555; border-radius: 8px; background: #202328f5; color: #eee; font: 13px system-ui, sans-serif; pointer-events: auto; }
label { display: flex; align-items: center; gap: 8px; }
select, button { min-height: 44px; padding: 4px 10px; border: 1px solid #666; border-radius: 6px; background: #343434; color: #fff; font: inherit; }
input { width: 112px; min-height: 44px; margin: 0; }
:focus-visible { outline: 2px solid #80b8ff; outline-offset: 2px; }
@media (orientation: landscape) { .touch-layout-editor { top: 72px; } }
</style>
