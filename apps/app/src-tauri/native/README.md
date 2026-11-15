# 原生工程与平台资源

`native/` 保存需要维护的脚本、源码和配置。Tauri 自动加载 `src-tauri/tauri.<平台>.conf.json`，各平台分别引用自己的图标目录。

| 目录 | 用途 |
| --- | --- |
| `windows/` | 生成窗口及安装包的 `icon.ico`。 |
| `linux/` | 生成 32、128、256 像素 PNG。 |
| `macos/` | 生成窗口 PNG 和带透明边距的 Dock ICNS；需要 macOS / Swift。 |
| `android/app/` | 维护 Gradle 签名、MainActivity 返回键、TV Manifest、显示名和 ProGuard 配置。 |
| `android/prepare.cjs` | 将维护的定制文件覆盖到生成工程，并同步图标。 |
| `ios/prepare.cjs` | 同步全画布 AppIcon 与多语言显示名，并重新生成 Xcode 工程。 |
| `../gen/android/`、`../gen/apple/` | Tauri 生成的 Android / iOS 工程，不纳入 Git。 |

首次运行 `pnpm android:init` 或 `pnpm ios:init`（iOS 需要 macOS）。开发、构建命令会重新应用准备脚本，长期修改应放在 `native/` 中。

图标源位于仓库 `apps/icon/`。`sync-icons.cjs` 分发到各平台脚本，共用生成函数通过 Node.js 调用 Tauri CLI，按源图、配置、脚本和 CLI 版本缓存结果。各平台 `icons/` 和仓库 `.tmp/` 不纳入 Git，缺失时重新生成。

Tauri 开发、构建前以及 `build.rs` 会自动生成当前目标平台的图标；根目录 `pnpm sync:icons` 刷新所有可在当前主机生成的平台图标及 Web 资源。

Android 沿用现有 `com.whilecode.gameemulator` 标识。签名仍从仓库根 `secrets/keystore.properties` 或环境变量读取，不应将密钥放进模板或生成工程。

应用显示名支持英文 `GameEmulator`、简体中文“游戏模拟器”和繁体中文“遊戲模擬器”。Android（含 TV）使用系统字符串资源，Apple 平台使用 `InfoPlist.strings`；Web 标题与启动页使用 `packages/shell/src/branding.ts`，桌面窗口标题跟随 WebView 语言。iOS 本地化资源需要通过 `prepare.cjs` 复制到应用 target 并运行 XcodeGen，不能仅放入 Tauri 的 `bundle.resources`。
