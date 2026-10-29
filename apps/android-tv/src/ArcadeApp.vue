<script setup lang="ts">
import { ArcadeView } from '@game-emulator/arcade'
function leave() { location.replace(new URL('index.html', location.href).href) }
</script>
<template><ArcadeView :on-leave="leave" /></template>
