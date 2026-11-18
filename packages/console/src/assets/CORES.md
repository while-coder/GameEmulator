# Bundled cartridge cores

The JS/WASM pairs come from the same pinned RetroArch 1.22.2 build repository used by Nostalgist 0.21.1. Runtime core downloads and CDN ZIP extraction are not used.

- mgba: https://raw.githubusercontent.com/arianrhodsandlot/retroarch-emscripten-build/v1.22.2/retroarch/mgba_libretro.zip
  - ZIP SHA-256: `d195371c3ea626c9246e9d3ab82ded4d93f3f99f85634af1588724cc44d47644`.
  - `mgba_libretro.js`: `08bfc90519bce409a72f206a28b78f02bda913ff7af22c2f36fb6b35734e5456`.
  - `mgba_libretro.wasm`: `3a80ac96ae8e82628ed483e8bb528669b03e7186a2cf90abf89a6d66c3aba6bb`.
- snes9x: https://raw.githubusercontent.com/arianrhodsandlot/retroarch-emscripten-build/v1.22.2/retroarch/snes9x_libretro.zip
  - ZIP SHA-256: `0d50b0e18607af87c0c6ed2d9068fcfd19514be09b004068c2b5f06783499ef4`.
  - `snes9x_libretro.js`: `0d6b2e8f3ccaee93354d4d41cb591a08c7201fb5e35146d3e75a0c5a786ba0c2`.
  - `snes9x_libretro.wasm`: `0a5f17704f96239ef05647d362b0dd478605368efce141382b8e22945062f1fd`.

mGBA: MPL-2.0 (`MGBA-LICENSE.txt`). Snes9x: non-commercial Snes9x license (`SNES9X-LICENSE.txt`, including component notices). RetroArch: GPLv3 (`packages/arcade/src/assets/cores/RETROARCH-COPYING.txt`). All are accessible in the player settings. Corresponding source: https://github.com/libretro/mgba, https://github.com/libretro/snes9x, https://github.com/libretro/RetroArch/tree/v1.22.2.

WASM state IDs: `mgba-ra1.22.2-wasm-v1`, `snes9x-ra1.22.2-wasm-v1`. Change these when upgrading binaries or state-affecting build settings. Android uses separately pinned native sources and separate state IDs; see `packages/android-native/android/src/main/cpp/vendor/README.md`.
