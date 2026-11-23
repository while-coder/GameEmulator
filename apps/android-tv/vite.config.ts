import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pspIsolation } from '../../scripts/psp-isolation'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue(), pspIsolation()],
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(['index', 'nes', 'arcade', 'gba', 'sfc', 'psp'].map(name => [
        name, fileURLToPath(new URL(`./${name}.html`, import.meta.url)),
      ])),
    },
  },
})
