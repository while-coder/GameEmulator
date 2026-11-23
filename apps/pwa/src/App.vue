<script setup lang="ts">
import { ref } from 'vue'
import { CurrentReleaseDialog, GameLobby, openPlayerPage } from '@game-emulator/shell'
import { version } from '../../../package.json'

const releaseModal = ref(false)
</script>
<template>
  <GameLobby :launch="openPlayerPage" :active="!releaseModal" />
  <CurrentReleaseDialog :version="version" :enabled="true" @modal-change="releaseModal = $event" />
</template>
