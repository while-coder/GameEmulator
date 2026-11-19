# GameEmulator

GameEmulator 是一款多平台经典游戏模拟器，支持 NES / FC（红白机）、GBA / GB / GBC、SFC / SNES 和街机游戏，让你在电脑、手机和平板上重温经典，也可通过 Android TV 版本在电视上游玩。

## 支持的游戏类型

- **NES / FC（红白机）**：重温经典 8 位主机游戏。
- **GBA / GB / GBC**：mGBA 内核，支持单机掌机游戏。
- **SFC / SNES（超级任天堂）**：Snes9x 内核，支持两个标准手柄。
- **街机**：支持 CPS、Neo Geo 等经典街机游戏，体验投币开局与双人同玩。

支持浏览在线游戏库，并提供键盘、手柄、触屏操作及即时存档功能。

普通 Android 版与独立 Android TV 版的 NES / FC、街机、mGBA 和 SFC 使用共用宿主的原生 `.so` 引擎；其他平台使用 WASM。原生即时存档与旧 WASM 存档分开保存，旧档保留但不能直接互读。构建与兼容性说明见 [Android 原生引擎](packages/android-native/README.md)。

## 在线体验

通过 GitHub Pages 提供网页版，无需下载安装，打开浏览器即可体验：

**[点击进入 GameEmulator 在线体验](https://while-coder.github.io/GameEmulator/)**

进入后选择模拟器，即可直接浏览游戏库；右上角「设置」可调整按键、显示和音频。点击游戏卡片会自动下载并启动，已下载的游戏复用本地缓存。游戏启动时沿用当前窗口状态，可按 F11 切换全屏。按 Esc / 返回键或点击画面右上角的暂停按钮打开菜单，可继续游戏、存读档、重新开始或返回游戏库。支持的浏览器还可将网页版添加到主屏幕，方便下次打开。

## 支持平台

- **网页版**：适用于电脑、手机和平板浏览器。
- **桌面版**：Windows、macOS、Linux。
- **移动版**：Android、iOS。
- **电视版**：独立 Android TV 应用。

iOS SideStore 统一订阅源：[while-coder Store](https://while-coder.github.io/store/sidestore.json)。iOS Release 成功后，工作流会同步应用版本和 `apps/icon/icon.png` 到 `while-coder/store`，同时保留 Release 中的独立 `apps.json` 源。CI 需要在 `BUILD_SIGNING_JSON` 中配置 `STORE_TOKEN`，并授予该令牌对 `while-coder/store` 的 Contents 读写权限。

桌面版和 Tauri Android 版在启动后自动检查更新，发现新版本时提示下载和安装；检查失败时不打断使用。Android 版也可在首页点击“检查更新”，并按提示授予安装权限。iOS、网页版和独立 Android TV 版不使用此应用内更新流程。

Tauri 应用和 PWA 启动时会展示当前版本的更新内容，内容来自 `CHANGELOG.md` 中对应版本的段落；点击“知道了”后，同一版本不再重复展示。Tauri 应用发现新版本时优先显示更新提示。PWA 在加载新版页面后展示对应版本的内容，离线时也可查看已缓存版本的说明。

游戏库优先显示目录中的 `screenshot_url`，否则根据 ROM 的 SHA-256 匹配 [Libretro 游戏截图](https://github.com/libretro-thumbnails/libretro-thumbnails)。未匹配或加载失败时显示占位图；截图按需加载。

本地封面资源保存在 `games/<平台>/screenshots/`，同一平台内按来源网址去重。`manifest.json` 记录游戏名、ROM 校验值、原始图片来源、公开截图地址、本地文件、图片校验值及缺图列表；NES 的 `matches.json` 额外记录匹配依据。目录中的 `screenshot_url` 指向对应 `nes-roms`、`arcade-roms`、`neogeo-roms` 仓库的 `screenshots/` 图片，应用按需加载。本地副本用于资源管理，尚未打包进应用。`games/` 仍由 Git 忽略。

游戏目录的 `download_url` 可保存相对于 `rom_url_base` 的路径（例如 `2020bb.zip`），游戏和依赖文件在读取目录时统一解析为完整地址；旧的完整 URL 仍然兼容。未指定 `rom_url_base` 时，相对路径按 `catalog.json` 所在目录解析。

NES / FC 与街机（含 Neo Geo）使用一致的存档方式：暂停菜单「保存进度」或存档页「新建存档」会新增普通存档，可保留多份、重命名和单独删除；Ctrl+S / F8 覆盖本游戏、当前内核的快速存档，F9 仅读取快速存档。旧街机存档按快速存档保留，原生与 WASM 存档仍分别保存并校验兼容性。

游戏库分为「在线游戏库」「我的游戏」「收藏」三个分类；「我的游戏」收纳玩过或已下载的游戏，同一游戏只显示一次。支持搜索、类型筛选和排序，搜索筛选栏在手机横竖屏下均保持一行。右键、触屏长按或遥控器菜单键可打开游戏操作菜单，支持开始游戏、单独下载、收藏或取消收藏、移除下载缓存。收藏与游玩记录保存在本地，删除下载缓存后仍保留。

名称排序将中文名转成无声调拼音，与英文名混排，数字按自然顺序排列（例如 2 在 10 前）。搜索支持中文、英文、拼音全拼、首字母和混输，例如「超级玛丽」可以通过 `chaoji`、`cjm`、`chaojml` 搜到；厂商、类型和标签也支持拼音搜索。

开始或下载游戏时显示全屏加载界面，展示游戏名称与下载进度；点击「取消」、按 Esc 或遥控器返回键可取消操作并返回列表。取消后不会自动启动游戏，已经完成校验并保存的下载会保留。

搜索框旁的刷新按钮会重新获取目录并同步下载状态，刷新期间保留当前列表与筛选。请求超时、离线或部分目录更新失败时显示简短说明与重试按钮。街机目录回退到缓存时会明确提示，不会误报更新成功；首次加载失败时也不会同时显示「暂无游戏」。

「在线游戏库」和「收藏」初次使用「默认排序」（游戏源中的目录顺序），「我的游戏」初次按「最近游玩」排序，未玩过的已下载游戏排在其后。NES 和街机的各分类分别将排序选择保存到本地，刷新或下次打开时恢复；搜索、类型筛选、页码和滚动位置在切换分类时保留。卡片显示累计游玩时长，仅成功启动后记录历史，单独下载也会加入「我的游戏」，但不产生游玩记录；暂停、设置和后台时间不计入游玩时长。返回游戏库、切换游戏或退出时保存，游玩中每 15 秒更新一次；排序菜单也可切换回「默认排序」。

## mGBA 与 SFC

在模拟器选择页进入「GBA / GB / GBC」或「SFC / SNES」，通过「设置 → 其他 → 导入游戏」导入本地 ROM。mGBA 接受 `.gba`、`.gb`、`.gbc`；SFC 接受 `.sfc`、`.smc`。ZIP 等压缩包需先解压；单个文件最多 64 MB。导入后的 ROM 保存在本机「我的游戏」，无需重复选择。mGBA 当前只提供单机游玩。

两个新入口共用 `packages/console` 播放器，游戏库和设置沿用 NES／街机的组件、样式与布局。设置分为「存档、按键、显示、音频、其他」五类；存档页可按游戏筛选、搜索并切换游戏读档。支持拼音搜索、分类、收藏、排序、下载缓存、游玩时长、暂停、全屏、键盘改键、标准手柄和可编辑触屏布局。GBA / GB / GBC 与 SFC 分别保存设置与数据，GB / GBC 自动使用 10:9 显示比例。Android TV 的自动触屏模式保持隐藏。

GBA / GB / GBC 与 SFC 分别固定使用 `while-coder/gba-roms`、`while-coder/sfc-roms` 仓库的 `main/catalog.json`，进入后自动加载在线游戏库，刷新按钮重新获取目录并同步下载状态。设置界面不提供游戏源地址配置。目录格式与现有 NES 目录一致，可选 `file_name` 用于下载地址没有 ROM 扩展名的情况：

```json
{
  "rom_url_base": "https://example.com/gba/",
  "games": [
    {
      "name": "My Homebrew",
      "download_url": "homebrew.gba",
      "file_name": "homebrew.gba",
      "file_size": 32768,
      "sha256": "<ROM 文件的 64 位 SHA-256>"
    }
  ]
}
```

还可提供 `genre`、`publisher`、`tags`、`screenshot_url`。目录按 SHA-256 去重，下载时校验大小和哈希；失败时保留已有缓存。内核已随应用打包，PWA 在成功安装缓存后支持离线启动已下载游戏。

默认键盘：方向键移动，X/Z 对应 A/B，Q/W 对应 L/R，Enter 开始，右 Shift 选择；SFC 的 S/A 对应 X/Y。Esc / 返回键暂停，F11 全屏，Ctrl+S / F8 覆盖快速存档，F9 读取快速存档。手柄可同时按 L3 + R3 暂停。暂停菜单「保存进度」新增普通存档，存档页支持重命名和删除。游戏内存档定期、暂停和正常退出时保存；即时存档按平台、ROM 与内核构建隔离，Android 原生和 WASM 不互读。

内核来源、校验值和许可证见 [WASM 核心说明](packages/console/src/assets/CORES.md) 和 [Android 原生源码说明](packages/android-native/android/src/main/cpp/vendor/README.md)。
