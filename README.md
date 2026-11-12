# GameEmulator

GameEmulator 是一款多平台经典游戏模拟器，支持 NES / FC（红白机）和街机游戏，让你在电脑、手机和平板上重温经典，也可通过 Android TV 版本在电视上游玩。

## 支持的游戏类型

- **NES / FC（红白机）**：重温经典 8 位主机游戏。
- **街机**：支持 CPS、Neo Geo 等经典街机游戏，体验投币开局与双人同玩。

支持浏览在线游戏库，并提供键盘、手柄、触屏操作及即时存档功能。

普通 Android 版与独立 Android TV 版的 NES / FC、街机使用共用的原生 `.so` 引擎；其他平台使用 WASM。原生即时存档与旧 WASM 存档分开保存，旧档保留但不能直接互读。构建与兼容性说明见 [Android 原生引擎](packages/android-native/README.md)。

## 在线体验

通过 GitHub Pages 提供网页版，无需下载安装，打开浏览器即可体验：

**[点击进入 GameEmulator 在线体验](https://while-coder.github.io/GameEmulator/)**

进入后选择模拟器，即可直接浏览游戏库；右上角「设置」可调整按键、显示和音频。点击游戏卡片会自动下载并启动，已下载的游戏复用本地缓存。游戏启动后自动全屏，按 Esc / 返回键或点击画面右上角的暂停按钮打开菜单，可继续游戏、存读档、重新开始或返回游戏库；F11 切换全屏。浏览器不允许原生全屏时，游戏画面会铺满页面。支持的浏览器还可将网页版添加到主屏幕，方便下次打开。

## 支持平台

- **网页版**：适用于电脑、手机和平板浏览器。
- **桌面版**：Windows、macOS、Linux。
- **移动版**：Android、iOS。
- **电视版**：独立 Android TV 应用。

iOS SideStore 统一订阅源：[while-coder Store](https://while-coder.github.io/store/sidestore.json)。iOS Release 成功后，工作流会同步应用版本和 `apps/icon/icon.png` 到 `while-coder/store`，同时保留 Release 中的独立 `apps.json` 源。CI 需要在 `BUILD_SIGNING_JSON` 中配置 `STORE_TOKEN`，并授予该令牌对 `while-coder/store` 的 Contents 读写权限。

桌面版和 Tauri Android 版在启动后自动检查更新，发现新版本时提示下载和安装；检查失败时不打断使用。Android 版也可在首页点击“检查更新”，并按提示授予安装权限。iOS、网页版和独立 Android TV 版不使用此应用内更新流程。

Tauri 应用和 PWA 启动时会展示当前版本的更新内容，内容来自 `CHANGELOG.md` 中对应版本的段落；点击“知道了”后，同一版本不再重复展示。Tauri 应用发现新版本时优先显示更新提示。PWA 在加载新版页面后展示对应版本的内容，离线时也可查看已缓存版本的说明。

游戏库优先显示目录中的 `screenshot_url`，否则根据 ROM 的 SHA-256 匹配 [Libretro 游戏截图](https://github.com/libretro-thumbnails/libretro-thumbnails)。未匹配或加载失败时显示占位图；截图按需加载。执行 `node scripts/sync-game-screenshots.cjs` 可根据本地 `games/*/catalog.json` 更新截图映射（需要联网）。

游戏目录的 `download_url` 可保存相对于 `rom_url_base` 的路径（例如 `2020bb.zip`），游戏和依赖文件在读取目录时统一解析为完整地址；旧的完整 URL 仍然兼容。未指定 `rom_url_base` 时，相对路径按 `catalog.json` 所在目录解析。

NES / FC 与街机（含 Neo Geo）使用一致的存档方式：暂停菜单「保存进度」或存档页「新建存档」会新增普通存档，可保留多份、重命名和单独删除；Ctrl+S / F8 覆盖本游戏、当前内核的快速存档，F9 仅读取快速存档。旧街机存档按快速存档保留，原生与 WASM 存档仍分别保存并校验兼容性。

游戏库默认按「最近游玩」排序，并在卡片显示累计游玩时长。仅成功启动后记录历史，暂停、设置和后台时间不计入；返回游戏库、切换游戏或退出时保存，游玩中每 15 秒更新一次。记录独立于 ROM 缓存，删除下载缓存后仍保留；排序菜单也可切换回目录顺序。
