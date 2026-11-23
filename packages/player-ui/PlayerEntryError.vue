<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRemoteNav } from './useRemoteNav'

defineProps<{ message: string }>()
const emit = defineEmits<{ back: [] }>()
const panel = ref<HTMLElement | null>(null)
const back = ref<HTMLButtonElement | null>(null)
useRemoteNav({ container: panel, active: ref(true), onBack: () => emit('back') })
onMounted(() => back.value?.focus({ preventScroll: true }))
</script>

<template>
  <section ref="panel" class="player-entry-error">
    <p role="alert">{{ message }}</p>
    <button ref="back" type="button" @click="emit('back')">返回游戏大厅</button>
  </section>
</template>

<style scoped>
.player-entry-error { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 24px; background: #171c24; color: #edf1f7; text-align: center; }
p { max-width: 38rem; margin: 0; overflow-wrap: anywhere; }
button { min-height: 40px; padding: 8px 16px; border: 1px solid #607189; border-radius: 8px; background: #252d39; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid #8aafe0; outline-offset: 3px; }
</style>
