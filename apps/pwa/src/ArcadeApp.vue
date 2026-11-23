<script setup lang="ts">
import { playerEntry, returnToLobby } from '@game-emulator/shell'
import { ArcadeView } from '@game-emulator/arcade'
const entry = playerEntry()
function leave() { returnToLobby() }
</script>
<template><ArcadeView :on-leave="leave" :entry="entry" /></template>
