# Game Emulator

## Directory structure

- `apps/pwa/`: thin Vue/Vite PWA host, deployable on its own.
- `packages/shell/`: simulator selection screen and metadata registry. It never imports emulator runtimes.
- `packages/nes/`: independent NES UI, input, settings, ROM library, save states, and libretro core assets.
- `apps/app/`: thin Tauri app host for desktop, Android, and iOS. Native view creation/destruction stays here; NES player UI stays in `packages/nes`.
- `apps/icon/`: shared icon artwork and Tauri icon generation manifest.
- `scripts/`: repository-level helper scripts.

## View lifecycle

Both frontend hosts build separate `index.html` (MainView) and `nes.html` (NesView) entrypoints. Shared Vue files may be reused by the build, but MainView does not load NES UI or its runtime. NES data keeps its existing `nes.settings`, ROM database, and save database names; moving the module does not migrate or delete data.

- **Desktop App:** MainView stays alive in the `main` window. Entering NES creates a full-window child WebView (`emulator-nes`). When NES mounts, the launcher WebView is hidden. Returning waits for pending save operations, stops the core, closes the NES WebView, and shows/focuses MainView. Reentering creates a new NES document. This uses Tauri's `unstable` multi-WebView feature.
- **Android/iOS App:** currently navigates the existing WebView to the independent NES document. Returning replaces that document with MainView. This resets the document's JS environment, but does **not** destroy/recreate a native WebView or retain a live MainView underneath. Native mobile view stacks remain a separate integration task; Android's minimum SDK stays 24.
- **PWA/browser:** independent full-page navigation. The return button and browser Back lead to the launcher. Page hiding stops the NES core; browser back/forward caching and memory reclamation remain browser-controlled. Both HTML documents and core assets are precached for offline use after installation.

In NES, Back closes a modal first, then stops a running game, then returns to the simulator list. An explicit “返回模拟器列表” button is available in the desktop toolbar; mobile devices use the system Back action. Returning does not automatically create a save state; use quick save or a named save before leaving.

To add another simulator, give it its own package and HTML entry, add launcher metadata in `packages/shell/src/registry.ts`, and register its entrypoint in both Vite hosts and the native view manager. Keep its settings and databases under its own namespace.

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
