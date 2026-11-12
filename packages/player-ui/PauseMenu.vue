<script setup lang="ts">
import { ref } from 'vue'
defineProps<{ gameName: string; busy?: boolean; message?: string }>()
defineEmits<{ resume: []; save: []; load: []; help: []; settings: []; exit: [] }>()
const panel = ref<HTMLElement | null>(null)
defineExpose({ panel })
</script>

<template>
  <div ref="panel" class="pause-menu">
    <p class="pause-game-name">{{ gameName }}</p>
    <fieldset class="pause-menu-actions" :disabled="busy">
      <button type="button" class="s-button pause-resume" @click="$emit('resume')">继续游戏</button>
      <button type="button" class="s-button" @click="$emit('save')">保存进度</button>
      <button type="button" class="s-button" @click="$emit('load')">读取进度</button>
      <button type="button" class="s-button" @click="$emit('help')">操作说明</button>
      <button type="button" class="s-button" @click="$emit('settings')">设置</button>
      <button type="button" class="s-button" @click="$emit('exit')">返回游戏库</button>
    </fieldset>
    <p v-if="message" role="status" class="pause-message">{{ message }}</p>
    <p class="pause-hint">Esc / 返回键可继续游戏</p>
  </div>
</template>

<style scoped>
.pause-menu { display: flex; flex-direction: column; gap: 16px; }
.pause-game-name { margin: 0; color: #bbb; text-align: center; overflow-wrap: anywhere; }
.pause-menu-actions { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; border: 0; min-width: 0; }
.pause-menu-actions .s-button { width: 100%; min-height: 44px; font-size: 15px; }
.pause-menu-actions .pause-resume { background: #2f6f9f; border-color: #2f6f9f; color: #fff; }
.pause-message, .pause-hint { margin: 0; text-align: center; font-size: 13px; color: #aaa; }
</style>
