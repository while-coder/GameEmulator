# nes-emulator

## Directory structure

- `apps/pwa/`: thin Vue/Vite PWA host, deployable on its own.
- `packages/ui/`: shared display area with the app shell, display, controls, settings, runtime wiring, and the libretro core assets.
- `apps/app/`: thin Tauri app host for desktop, Android, and iOS. Native exit/back handling stays here; shared player UI stays in `packages/ui`.
- `apps/icon/`: shared icon artwork and Tauri icon generation manifest.
- `scripts/`: repository-level helper scripts.

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
- To switch ROM hosting, update the catalog URL in `packages/ui/src/store/romCatalog.ts`, and provide a catalog whose `download_url` values point at the new CORS-enabled source.
