<script setup lang="ts">
defineProps<{ controls: { id: string; label: string }[]; selected: string; scale: number; hidden: boolean }>()
const emit = defineEmits<{ select: [id: string]; resize: [scale: number]; toggle: [] }>()
</script>

<template>
  <Teleport to=".layout-edit-tools">
    <div class="touch-layout-editor" data-layout-editor @pointerdown.stop @click.stop>
      <label>控件
        <select :value="selected" @change="emit('select', ($event.target as HTMLSelectElement).value)">
          <option v-for="control in controls" :key="control.id" :value="control.id">{{ control.label }}</option>
        </select>
      </label>
      <label><span class="scale-value">大小 {{ Math.round(scale * 100) }}%</span>
        <input type="range" min="0.75" max="1.75" step="0.05" :value="scale" @input="emit('resize', Number(($event.target as HTMLInputElement).value))" />
      </label>
      <button v-if="selected !== 'dpad'" class="layout-button" type="button" :aria-pressed="hidden" @click="emit('toggle')">{{ hidden ? '显示按钮' : '隐藏按钮' }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.touch-layout-editor { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; padding-top: 12px; border-top: 1px solid #414141; color: #ddd; font: inherit; pointer-events: auto; }
label { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
label:nth-child(2) { flex: 1; min-width: 0; }
.scale-value { min-width: 72px; font-variant-numeric: tabular-nums; }
select { box-sizing: border-box; height: 44px; min-width: 68px; padding: 0 8px; border: 1px solid #555; border-radius: 6px; background: #343434; color: #eee; font: inherit; }
input { flex: 1; min-width: 0; width: 100%; height: 44px; margin: 0; accent-color: #80b8ff; }
:focus-visible { outline: 2px solid #80b8ff; outline-offset: 2px; }
@media (max-width: 480px) {
  .touch-layout-editor { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  label:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
}
</style>
