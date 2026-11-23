<script setup lang="ts">
import { playerEntry, returnToLobby } from '@game-emulator/shell'
import { NesView } from '@game-emulator/nes'
const entry = playerEntry()
function leave() { returnToLobby() }
</script>
<template><NesView :on-leave="leave" :entry="entry" /></template>
