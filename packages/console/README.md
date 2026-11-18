# Cartridge player

Shared mGBA (GBA/GB/GBC) and Snes9x (SFC/SNES) frontend. Each app has separate `gba.html` and `sfc.html` entry documents; the launcher does not import this runtime.

- `systems.ts`: extensions, buttons, keyboard/gamepad mappings and display aspect.
- `runner.ts`: pinned local WASM cores, pause/input/state and SRAM persistence.
- `store.ts`: transactional IndexedDB ROM/state/SRAM storage; catalog and verified downloads.
- `ConsoleView.vue`: shared library, playback, input, settings and save UI.
- `TouchControls.vue`: shared layout editor with platform-specific buttons.
- Android entries register `NativeConsoleRunner`; other entries use WASM. Saves include the core build identity in their storage keys.

See the root README for catalog format and controls, and `src/assets/CORES.md` for core provenance and licenses.

## Checks

`pnpm test:console` starts Vite and headless Chrome, generates minimal test cartridges, and exercises the actual bundled WASM cores. Set `CHROME_BIN` to a Chromium executable outside the default macOS location. No external ROMs, BIOS, browser packages or game services are required. The checks cover load cancellation, GBA/GB/SFC playback, pause, normal/quick states, state restore, repeat loads, local import, favorites, SFC battery persistence and phone viewports.

For a host compilation check of the exact native source lists:

```sh
cmake -S scripts/console-native-check -B .tmp/console-native-check/build
cmake --build .tmp/console-native-check/build --target mgba_libretro snes9x -j 4
```

This validates the two cores on the host; it does not validate the Android JNI/TextureView integration or device performance. Build the Android app with the documented SDK/NDK and validate on phones/TVs before release.

## Generate game catalogs

```sh
python3 scripts/generate-console-catalogs.py --plan
python3 scripts/generate-console-catalogs.py --workers 8
```

Run from the repository root. Pinned repositories and classic-title selection rules are in `scripts/console-catalog-sources.json`. The generator combines classic selections with the Retrobrews homebrew collections, and writes `games/gba/catalog.json`, `games/sfc/catalog.json`, and `games/console-catalog-report.json`, following the existing git-ignored local game-library layout. The mGBA catalog includes GB/GBC alongside GBA. ROM bytes are cached in each platform's `roms/` directory.

Every included ROM is downloaded and checked against the source repository's file size and Git blob identity before its SHA-256 is recorded. Fresh downloads must allow browser CORS and must not return HTML or Git LFS pointers. Duplicate SHA-256 values are combined. Catalogs use pinned upstream raw URLs, so uploading a catalog does not require mirroring its ROM files. Game names retain the source names and language tags describe the selected release; a Chinese interface does not imply a Chinese ROM translation. Hardware-specific tilt, solar-sensor and light-gun titles are omitted from the classic selections. File integrity checks do not establish gameplay compatibility.

To use a generated catalog, serve the JSON through HTTP(S), then enter that URL in the player's game-source settings. No remote repository is created and no catalog is published by the generator. Upstream Retrobrews distribution permissions apply to its own repository; the generator links to that source and does not grant additional redistribution rights.
