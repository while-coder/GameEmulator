import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(['index', 'nes', 'arcade'].map(name => [
        name, fileURLToPath(new URL(`./${name}.html`, import.meta.url)),
      ])),
    },
  },
})
