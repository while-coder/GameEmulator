# GameEmulator

GameEmulator 是一款多平台经典游戏模拟器，支持 NES / FC（红白机）和街机游戏，让你在电脑、手机和平板上重温经典，也可通过 Android TV 版本在电视上游玩。

## 支持的游戏类型

- **NES / FC（红白机）**：重温经典 8 位主机游戏。
- **街机**：支持 CPS、Neo Geo 等经典街机游戏，体验投币开局与双人同玩。

支持导入本地游戏、浏览在线游戏库，并提供键盘、手柄、触屏操作及即时存档功能。

## 在线体验

通过 GitHub Pages 提供网页版，无需下载安装，打开浏览器即可体验：

**[点击进入 GameEmulator 在线体验](https://while-coder.github.io/GameEmulator/)**

进入后选择模拟器，再从游戏库选择游戏或导入本地游戏文件。支持的浏览器还可将网页版添加到主屏幕，方便下次打开。

## 支持平台

- **网页版**：适用于电脑、手机和平板浏览器。
- **桌面版**：Windows、macOS、Linux。
- **移动版**：Android、iOS。
- **电视版**：独立 Android TV 应用。

iOS SideStore 统一订阅源：[while-coder Store](https://while-coder.github.io/store/sidestore.json)。iOS Release 成功后，工作流会同步应用版本和 `apps/icon/icon.png` 到 `while-coder/store`，同时保留 Release 中的独立 `apps.json` 源。CI 需要在 `BUILD_SIGNING_JSON` 中配置 `STORE_TOKEN`，并授予该令牌对 `while-coder/store` 的 Contents 读写权限。

桌面版和 Tauri Android 版在启动后自动检查更新，发现新版本时提示下载和安装；检查失败时不打断使用。Android 版也可在首页点击“检查更新”，并按提示授予安装权限。iOS、网页版和独立 Android TV 版不使用此应用内更新流程。

Tauri 应用和 PWA 启动时会展示当前版本的更新内容，内容来自 `CHANGELOG.md` 中对应版本的段落；点击“知道了”后，同一版本不再重复展示。Tauri 应用发现新版本时优先显示更新提示。PWA 在加载新版页面后展示对应版本的内容，离线时也可查看已缓存版本的说明。
