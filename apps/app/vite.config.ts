import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Tauri 移动端开发时会注入 TAURI_DEV_HOST（局域网 IP），
// 让 vite 绑定该地址，真机才能访问到 dev server。桌面开发时该变量为空，走 localhost。
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    host: host || false,
    port: 1801,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1802,
        }
      : undefined,
  },
})
