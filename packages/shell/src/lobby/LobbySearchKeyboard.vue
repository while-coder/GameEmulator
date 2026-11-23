<script setup lang="ts">
import LibrarySearch from '../../../player-ui/LibrarySearch.vue'

const query = defineModel<string>({ required: true })
const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']
const limit = 120

function append(key: string) {
  if (query.value.length < limit) query.value += key
}

function remove() {
  query.value = Array.from(query.value).slice(0, -1).join('')
}
</script>

<template>
  <section id="lobby-search-keyboard" class="search-keyboard" aria-label="搜索键盘"
    data-nav-grid data-nav-exit-right="#lobby-search-results [data-nav-primary]">
    <div class="search-keyword">
      <LibrarySearch v-model="query" :open="true" :max-length="limit" />
    </div>
    <div class="keyboard-keys">
      <button v-for="key in keys" :key="key" type="button" data-nav-primary :data-search-key="key"
        :data-lobby-focus="key === 'A' ? 'search-keyboard' : undefined" @click="append(key)">{{ key }}</button>
    </div>
    <div class="keyboard-actions">
      <button type="button" data-nav-primary @click="append(' ')">空格</button>
      <button type="button" data-nav-primary :aria-disabled="!query" @click="remove">删除</button>
      <button type="button" data-nav-primary :aria-disabled="!query" @click="query = ''">清空</button>
    </div>
  </section>
</template>

<style scoped>
.search-keyboard {
  --search-key-height: clamp(25px, 6.2dvh, 46px);
  display: flex;
  flex-direction: column;
  align-self: start;
  min-width: 0;
  gap: 7px;
  padding: 8px 4px;
}
.search-keyword { display: flex; }
.keyboard-keys, .keyboard-actions { display: grid; gap: 6px; }
.keyboard-keys { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.keyboard-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.search-keyboard button {
  min-width: 0;
  min-height: var(--search-key-height);
  padding: 2px;
  border: 1px solid #465368;
  border-radius: 6px;
  background: #252d39;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.keyboard-keys button { font-variant-numeric: tabular-nums; font-weight: 600; }
.search-keyboard button[aria-disabled="true"] { color: #9baabb; }
@media (max-width: 550px) {
  .search-keyboard { --search-key-height: clamp(26px, 4dvh, 36px); padding-block: 2px; }
  .keyboard-keys { grid-template-columns: repeat(9, minmax(0, 1fr)); }
}
</style>
