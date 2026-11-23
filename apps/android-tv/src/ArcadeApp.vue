<script setup lang="ts">
import { ArcadeView } from '@game-emulator/arcade'
import { playerEntry, returnToLobby } from '@game-emulator/shell'
const entry = playerEntry()
</script>
<template><ArcadeView :on-leave="returnToLobby" :entry="entry" /></template>
