<script setup lang="ts">
import { NesView } from '@game-emulator/nes'
function leave() { location.replace(new URL('index.html', location.href).href) }
</script>
<template><NesView :on-leave="leave" platform-label="NES / FC · Web" /></template>
