import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const manifest: Partial<ManifestOptions> = {
  name: 'GameEmulator',
  short_name: 'GameEmulator',
  description: '选择模拟器，游玩经典游戏，支持触屏手柄与存档。',
  lang: 'en',
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
    { src: 'icons/gameemulator-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/gameemulator-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/gameemulator-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

export default defineConfig({
  plugins: [
    vue(),
    localizedManifests(),
    VitePWA({
      registerType: 'autoUpdate',
      // 自动注入 Service Worker 注册脚本,无需改 main.ts。
      injectRegister: 'auto',
      // public/icons 下的生成图标纳入预缓存(它们不被构建引用)。
      includeAssets: ['icons/gameemulator-favicon.png', 'icons/gameemulator-apple-touch-icon.png', 'icons/gameemulator-192.png', 'icons/gameemulator-512.png', 'icons/gameemulator-maskable-512.png'],
      manifest,
      workbox: {
        // Preserve separate emulator documents when navigating offline.
        navigateFallback: null,
        // 纳入 wasm:libretro 核心(fceumm_libretro.wasm)需被 PWA 预缓存以支持离线。
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm,webmanifest}'],
        // NES 与街机核心均预缓存；街机 WASM 约 12 MB。
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
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
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        nes: fileURLToPath(new URL('./nes.html', import.meta.url)),
        arcade: fileURLToPath(new URL('./arcade.html', import.meta.url)),
      },
    },
  },
})

// Keep the install identity and URLs shared across all language variants.
function localizedManifests(): Plugin {
  const variants = Object.entries({ 'zh-Hans': '游戏模拟器', 'zh-Hant': '遊戲模擬器' }).map(([lang, name]) => ({
    fileName: `manifest.${lang}.webmanifest`,
    source: JSON.stringify({ ...manifest, name, short_name: name, lang }),
  }))
  return {
    name: 'localized-app-manifests',
    generateBundle() {
      for (const variant of variants) this.emitFile({ type: 'asset', ...variant })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const variant = variants.find(item => req.url?.split('?')[0] === '/' + item.fileName)
        if (!variant) return next()
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(variant.source)
      })
    },
  }
}
