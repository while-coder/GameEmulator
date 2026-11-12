# Shared Android emulator backend

Both the ordinary Tauri Android APK and the standalone Android TV APK use this
module for **NES/FC and arcade**. Desktop, iOS and PWA continue using WASM.

The TypeScript adapters are a workspace package, `@game-emulator/android-native`,
with `/nes`, `/arcade` and `/transport` exports. Both apps declare this dependency;
the package declares its own NES/arcade dependencies so TypeScript and Vite can
resolve them from the shared source directory after a clean pnpm install.

- FCEUmm: `libfceumm.so`.
- FB Alpha 2012 / FBA 0.2.97.29 ROM sets: `libfbalpha2012.so`.
- Common libretro host, EGL/OpenGL ES and Oboe audio: `libgameemulator.so`.
- All three libraries build for ARM32, ARM64, x86 and x86_64; the TV app packages ARM32/ARM64.
- Native sources, checksums and licenses: [vendor](android/src/main/cpp/vendor/README.md).

## Integration and builds

The Android library is included as `:emulator-native`. The Tauri project's
`native/android/prepare.cjs` regenerates its Gradle inclusion; edit that template,
not ignored `gen/android` files. NDK **28.2.13676358**, CMake **3.22.1**, SDK 36
and JDK 17+ are required. CMake validates vendored source archives and builds offline.

The release workflow checks both Android frontends before creating the release.
The ordinary APK and TV APK then build independently of the desktop release.
The ordinary Android init step installs the NDK/CMake versions above and sets
`NDK_HOME`, overriding the reusable workflow's older default NDK. Both release
jobs require the Android keystore, password, alias and key password, supplied via
`BUILD_SIGNING_JSON` or the corresponding `ANDROID_*` secrets.

```sh
pnpm android:build --debug --apk --ci
pnpm build:android-tv
pnpm test:android-tv
```

The ordinary app uses an origin-restricted AndroidX WebMessage listener. It does
not replace Wry's WebViewClient or run a local HTTP service. The TV app uses its
fixed-origin asset server with custom-header and Origin checks and no CORS access.
Android System WebView must support `WEB_MESSAGE_LISTENER`; unsupported versions
report an error rather than falling back to WASM. Native factories are registered
only in the Android entries. Other clients keep their existing WASM runners.

Only commands, ROMs and state files cross these bridges. Emulation, rendering,
audio and physical gamepad input run outside JavaScript. ROM ZIPs, parent ROMs and
BIOS files transfer in 256 KiB chunks, retain their names and are checked against
the library's SHA-256 before loading. Each file is limited to 128 MiB; one bundle
to 512 MiB. The working cache is replaced when preparing another arcade game.

## Behavior and persistence

- Vue retains the library, downloads, settings, keyboard/touch controls and save UI.
- A TextureView covers only the game's canvas while playing. Pausing captures one
  still frame and hides the native view so page menus remain accessible.
- EGL uploads RGB565 directly, reuses texture storage, handles pitch/rotation and
  supports smoothing/scanlines. Aspect and integer scaling remain page-controlled.
- Physical gamepad input is native. NES keeps per-player custom bindings and turbo;
  arcade uses the existing standard two-player/six-button mapping.
- Backgrounding, audio focus loss and controller disconnect pause playback. Audio
  output pauses too; resuming requires user action. Keyboard and touch input still
  use the page's mappings.
- SRAM is saved periodically if changed, on pause and unload, using temporary-file
  replacement. FBA's own NVRAM is stored in the persistent native save directory.
- Instant states include native build identity, ROM/bundle identity and checksum.
  Quick slots are separate from WASM; saving/deleting arcade states affects only
  the selected core build. Existing WASM states stay visible and are not converted.
- Non-1x NES speed currently runs without audio. Native state payloads are capped at
  8 MiB. No netplay, rewind or external RetroArch installation is introduced.
- The NES input-debug setting shows native emulation/presentation FPS, core frame
  time, missed deadlines and audio underruns. These are not end-to-end latency readings.

## Validation boundary

Build checks and transport tests do not demonstrate device performance. On the
target phone and TV, compare identical ROMs with the previous APK, then check:

1. NES and CPS/Neo Geo gameplay and audio for 30 minutes, including parent/BIOS loading.
2. Two controllers, custom NES bindings, turbo, touch/keyboard input and unplug/reconnect.
3. Menus, pause/resume, portrait arcade rotation, fullscreen and phone orientation changes.
4. SRAM/NVRAM after restart; instant save/load; old WASM records remain intact.
5. Repeated game switching, return to launcher, background/focus loss and recreation.
