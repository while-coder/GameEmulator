# Game Emulator

## Directory structure

- `apps/pwa/`: thin Vue/Vite PWA host, deployable on its own.
- `packages/shell/`: simulator selection screen and metadata registry. It never imports emulator runtimes.
- `packages/nes/`: independent NES UI, input, settings, ROM library, save states, and libretro core assets.
- `packages/arcade/`: independent arcade UI, local ZIP library, BIOS/parent dependencies, two-player input, snapshots, and pinned FB Alpha 2012 core.
- `apps/app/`: thin Tauri app host for desktop, Android, and iOS. Native view creation/destruction stays here; each emulator owns its player UI.
- `apps/icon/`: shared icon artwork and Tauri icon generation manifest.
- `scripts/`: repository-level helper scripts.

## View lifecycle

Both frontend hosts build separate `index.html` (MainView), `nes.html` (NesView), and `arcade.html` (ArcadeView) entrypoints. MainView only imports launcher metadata. The two emulator packages do not import each other; shared dependency files may be reused by the build, with independent runtime state in each document. NES data keeps its existing `nes.settings`, ROM database, and save database names; moving the module does not migrate or delete data.

- **Desktop App:** MainView stays alive in the `main` window. Entering an emulator creates a full-window child WebView (`emulator-nes` or `emulator-arcade`). When its page mounts, the launcher WebView is hidden. Only one emulator view may be open at a time. Returning waits for pending save operations, stops the core, closes the emulator WebView, and shows/focuses MainView. Reentering creates a new emulator document. This uses Tauri's `unstable` multi-WebView feature.
- **Android/iOS App:** currently navigates the existing WebView to the independent emulator document. Returning replaces that document with MainView. This resets the document's JS environment, but does **not** destroy/recreate a native WebView or retain a live MainView underneath. Native mobile view stacks remain a separate integration task; Android's minimum SDK stays 24.
- **PWA/browser:** independent full-page navigation. The return button and browser Back lead to the launcher. Page hiding stops the active core; browser back/forward caching and memory reclamation remain browser-controlled. All HTML entrypoints and core assets are precached for offline use after installation.

In NES, Back closes a modal first, then stops a running game, then returns to the simulator list. An explicit “返回模拟器列表” button is available in the desktop toolbar; mobile devices use the system Back action. Returning does not automatically create a save state; use quick save or a named save before leaving.

To add another simulator, give it its own package and HTML entry, add launcher metadata in `packages/shell/src/registry.ts`, and register its entrypoint in both Vite hosts and the native view manager. Keep its settings and databases under its own namespace.

## Arcade

Enter **ARCADE / 街机** from the launcher. The first version uses the bundled FB Alpha 2012 core with **FBA 0.2.97.29 ZIP ROM sets**. It does not accept arbitrary ZIPs from newer MAME/FBNeo sets. Keep the original archive filename and do not extract it.

1. **游戏库** loads the CPS and Neo Geo network catalogs automatically, with search, genre filters, sorting, pagination, and a downloaded-only filter. Choose **下载** to cache a game and its dependencies, or **下载并启动** to play immediately. Importing local game ZIPs remains available.
2. Game ZIPs and required BIOS/parent ZIPs are downloaded, checked for size, ZIP validity and SHA-256, and cached automatically. Imported game ZIPs are matched to catalog entries by SHA-256. A parent already imported as a game is reused. The library shows download progress and offers retry on failure. Games absent from the catalog report that their dependencies cannot be determined automatically.
3. Start a game, insert a coin, and press Start. Two players can use keyboards/gamepads together; touch controls provide an eight-way stick, six action buttons, Coin, and Start for player one.
4. **Esc** opens/closes settings and pauses/resumes the game; **Ctrl+S** overwrites its quick snapshot; **F11** toggles fullscreen. The **存档** tab restores a snapshot, automatically launching the matching game and dependencies when necessary.

Default keyboard bindings: player 1 WASD + U/I/O/J/K/L, Coin **5**, Start **1**; player 2 arrows + numpad 4/5/6/1/2/3, Coin **6**, Start **2**. Bindings can be changed separately in **按键**. The six action buttons use the core's Y/X/L, B/A/R layout; individual games may map these controls differently.

Arcade settings use `arcade.settings`; archives, saves, and remote catalogs use the separate `arcade-library` IndexedDB database. Save identity includes the exact game, resolved dependencies, and pinned core build, preventing accidental restore into a different ROM or core version. Previously imported dependencies remain cached. BIOS, ROM binaries, and catalog JSON are not bundled. Once the catalogs and required ZIPs are cached, launching does not require a network connection. The database upgrade preserves existing games and saves.

Catalogs are read remotely when the game library opens in each document. The default catalogs are `https://da2.diandian.info/files/arcade-roms/catalog.json` and `https://da2.diandian.info/files/neogeo-roms/catalog.json`. Each catalog and its `roms/` directory are hosted together under the corresponding CDN directory. To use different locations, set `VITE_ARCADE_CATALOG_URLS` to comma-separated catalog URLs in the selected host's Vite environment (`apps/pwa/.env.local` or `apps/app/.env.local`) before building. Each URL has its own persisted cache. A network failure, HTTP error, invalid catalog, or 8-second timeout falls back to that URL's last validated catalog; without a cache, the error provides a retry path. One unavailable source does not prevent launching a game found in another source. Catalog fetches are reused within the document; reopen the emulator to check for updates.

`games[].dependencies` contains ZIP filenames; `dependency_files` supplies download URLs, sizes and SHA-256 values. Parent entries in `games` may themselves have dependencies, which are resolved recursively; cycles, missing descriptors, and conflicting file versions are rejected before a remote catalog is cached. Relative download URLs resolve against the catalog URL.

`scripts/prepare-arcade-cdn.py --output NEW_DIRECTORY` prepares verified CPS and Neo Geo CDN libraries. Chinese titles come from the pinned [rom-name-cn](https://github.com/yingw/rom-name-cn) CSVs in `scripts/data/rom-name-cn/`, matched by system and ROM shortname; original version suffixes are retained. `name_en` preserves the English name for search, and unmatched games keep their original name. To update only an existing upload package's names, run `python scripts/arcade_catalog_names.py --root UPLOAD_DIRECTORY`. Upload each library's `ROM-NAME-CN-NOTICE.md` alongside its catalog to preserve the upstream attribution and non-commercial usage notice.

To use a single GitHub Release, set `VITE_ARCADE_ROM_URL_BASE=https://github.com/OWNER/REPO/releases/download/TAG/` in the selected host's Vite environment (`apps/pwa/.env.local` or `apps/app/.env.local`) before building. Replace OWNER, REPO and TAG with the actual published release. This overrides ZIP URLs while preserving catalog filenames and checksums. Without an override, downloads use each catalog entry's URL. Browser downloads require CORS headers from both the download URL and its final redirect destination. GitHub Release and archive.org ZIPs currently lack these headers, so browser hosts require a CORS-enabled mirror or download proxy; an ordinary downloadable link alone is insufficient.

Core provenance, checksums, source links, and license details are in [CORE.md](packages/arcade/src/assets/cores/CORE.md). FB Alpha has a non-commercial license; RetroArch is GPLv3. Both license texts are bundled and visible in arcade settings. PWA precaches the roughly 12 MB arcade WASM along with the existing NES assets.

## Build

- `pnpm install`: install workspace dependencies.
- `pnpm --filter @nes-emulator/pwa run build`: build the standalone Web app.
- `pnpm --filter @nes-emulator/app run build:frontend`: build the App frontend into `apps/app/dist`.
- `pnpm --filter @nes-emulator/app run build`: build the Tauri app shell, using `apps/app/dist`.
- `pnpm dev:pwa` / `pnpm dev:app`: start the PWA / Tauri app.

## Versions and icons

- Update the root `package.json` version, then run `pnpm sync:versions` to synchronize workspace package versions and the application's Rust version in `Cargo.toml` / `Cargo.lock`. Tauri reads the root version directly.
- Run `pnpm sync:icons` after changing `apps/icon/icon.png`, `icon-fullbleed.png`, or `icons.json`. This refreshes PWA, App frontend, and native icons; macOS Dock generation requires macOS. `pnpm sync:icons --web` refreshes frontend icons only.
- `icon.png` supplies desktop and general browser icons; `icon-fullbleed.png` supplies Android adaptive foreground, iOS, and PWA maskable icons. `icon.svg` preserves the original editable artwork.
- Native icons are generated into `apps/app/src-tauri/native/<platform>/icons/` and cached in `.tmp/native-icons/`. Both are ignored by Git. Tauri hooks and `build.rs` generate the target platform's icons automatically, including direct Cargo builds.

## Native projects

- `pnpm android:init` generates the Android project and applies the maintained customizations from `apps/app/src-tauri/native/android/app/` (signing, back navigation, TV support, and display names).
- `pnpm ios:init` generates the iOS project and synchronizes its icons (requires macOS).
- Mobile dev/build scripts reapply platform preparation. Keep persistent changes in `native/`; generated projects under `src-tauri/gen/` are ignored by Git.
- Android retains its existing `com.wandergame.nesemulator` application ID through `tauri.android.conf.json`. Signing still uses root `secrets/keystore.properties` or `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` environment variables.
- See [native resources](apps/app/src-tauri/native/README.md) for platform paths.

## ROM catalog

- Web and App load the ROM catalog from the remote GitHub raw URL at runtime, so the large catalog is not bundled into the frontend output.
- ROM download URLs are used exactly as written in the remote catalog.
- To switch ROM hosting, update the catalog URL in `packages/nes/src/store/romCatalog.ts`, and provide a catalog whose `download_url` values point at the new CORS-enabled source.
