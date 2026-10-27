import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // 自动注入 Service Worker 注册脚本,无需改 main.ts。
      injectRegister: 'auto',
      // public 下的图标纳入预缓存(它们不被构建引用)。
      includeAssets: ['favicon.png', 'pwa-256.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'NES/FC 模拟器',
        short_name: 'NES',
        description: 'NES/FC 在线模拟器,支持触屏手柄与存档,可添加到主屏全屏游玩。',
        lang: 'zh-CN',
        display: 'standalone',
        // Android 上优先 fullscreen(隐藏系统状态栏);不支持时回退 standalone。
        // iOS PWA 由 apple-mobile-web-app-capable + status-bar-style 控制,与此无关。
        display_override: ['fullscreen', 'standalone'],
        // 不锁定方向,跟随系统(竖屏/横屏皆可)。
        background_color: '#202328',
        theme_color: '#202328',
        // 相对路径,适配 GitHub Pages 子路径部署。
        start_url: '.',
        scope: '.',
        // 声明尺寸必须与文件实际尺寸一致,否则浏览器忽略该图标,可能导致不可安装。
        icons: [
          { src: 'pwa-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 纳入 wasm:libretro 核心(fceumm_libretro.wasm)需被 PWA 预缓存以支持离线。
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm}'],
        // fceumm 核心 wasm 约 3MB,放宽单文件预缓存上限留足余量。
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  // GitHub Pages 子路径部署需要相对资源路径。
  base: './',
  server: {
    port: 1800,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
})
