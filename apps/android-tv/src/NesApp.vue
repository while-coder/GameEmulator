<script setup lang="ts">
import { NesView } from '@game-emulator/nes'
import { playerEntry, returnToLobby } from '@game-emulator/shell'
const entry = playerEntry()
</script>
<template><NesView :on-leave="returnToLobby" :entry="entry" /></template>
