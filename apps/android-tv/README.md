# Android TV / GeckoView

独立的 Kotlin + GeckoView APK，复用 `packages/shell`、`packages/nes` 和 `packages/arcade`。不使用 Tauri 或系统 Android WebView。

## 构建

需要 JDK 17+、Android SDK 36，设置 `ANDROID_HOME`（或在 `android/local.properties` 中配置 `sdk.dir`）。首次构建需要访问 Google Maven、Maven Central 和 Mozilla Maven。

```sh
pnpm install
pnpm build:android-tv          # 调试 APK
pnpm android-tv:install       # 构建并通过 ADB 安装调试版
pnpm test:android-tv          # 返回键桥接测试及本地 HTTP 服务 JVM 测试
pnpm build:android-tv:release # Release APK
```

输出目录：`android/app/build/outputs/apk/debug/` 和 `android/app/build/outputs/apk/release/`。

发布签名复用根目录 `secrets/keystore.properties` 或 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。未配置签名时 Release 输出为 unsigned，不能直接安装。

直接从 Android Studio 构建前，先运行 `pnpm build:android-tv:frontend`。Gradle 自动从 `apps/icon/icon.png` 生成图标资源。根目录的 APK 构建命令会自动先构建前端。

## 运行方式

- 最低 Android 8 / API 26，包含 ARMv7 和 ARM64 内核。横屏、沉浸式显示，运行期间保持亮屏；包含 Android TV 启动入口。
- Release 包名 `com.wandergame.gameemulator.tv`，Debug 为 `com.wandergame.gameemulator.tv.debug`。可与原 Tauri 版并装；两者的游戏库、设置、存档相互独立，本版不迁移旧数据。
- 三个 HTML 页面、两个 WASM 核心全部随 APK 打包；不注册 Service Worker。在线目录和 ROM 下载仍需网络，已缓存的游戏可离线运行。
- 本地资源服务器只绑定 `127.0.0.1:17864`，页面来源固定为 `http://127.0.0.1:17864`，以保持 IndexedDB 身份，并提供浏览器安全上下文及正确的 WASM MIME。不要随意修改端口；若端口被其他程序占用，会显示启动错误。
- GeckoRuntime 使用正常持久化配置，生命周期属于 Application。Activity 停止时将会话设为 inactive；页面仍使用现有的暂停与离开逻辑。
- 内置 WebExtension 通过 Gecko 原生消息端口调用页面已有的 `window.__handleAndroidBack()`。返回键语义与共享包一致：关面板、停止游戏、返回列表；主页返回退出 Activity。
- 文件导入通过系统 `ACTION_OPEN_DOCUMENT` 选择文件。部分电视没有文件选择器，届时显示提示，可继续使用在线游戏库。
- Debug 启用 Gecko 远程调试，可用桌面 Firefox `about:debugging` 连接设备。Release 关闭调试。

## 当前范围与验证

这版提供应用宿主、资源服务、返回键、文件选择、全屏和前后台会话处理；不包含原 Tauri 的 APK 自动更新功能。升级需重新安装同包名、同签名 APK。

本版为匹配 SDK 36 工具链，固定 GeckoView `149.0.20260403140140`，配置位于 `android/app/build.gradle.kts`。内核升级随 APK 发布，不依赖系统 WebView 更新；升级内核时需同时检查 SDK、Kotlin 和 Android Gradle Plugin 的要求。框架集成参考 [Mozilla GeckoView 文档](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html) 和 [WebExtension 通信文档](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html)。

编译和自动测试不代替 TV 真机验证。安装后应检查：遥控器遍历菜单与返回、蓝牙/USB 双手柄、NES 和街机帧率/音频、文件导入、重启后游戏库与存档、切后台后的声音，以及断网启动缓存游戏。

自定义 ROM 目录时，可在本目录 `.env.local` 设置与其他宿主相同的 `VITE_ARCADE_CATALOG_URLS`、`VITE_ARCADE_ROM_URL_BASE`。下载仍使用浏览器 fetch，远端需要正确的 CORS 响应头。
