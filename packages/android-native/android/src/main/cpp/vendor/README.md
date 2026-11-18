# Android native source inputs

The archives are unmodified source, compiled locally for armeabi-v7a, arm64-v8a, x86 and x86_64.
Their SHA-256 checksums are verified by CMakeLists.txt before extraction.

- FCEUmm: https://github.com/libretro/libretro-fceumm/tree/e0f3086a8104f8fbbe49a2615b10401504a9533f
  - Archive: `fceumm-source-e0f3086.tar.gz`, SHA-256 `7a81aa960e0424f736ceaf3221b93663f7ae0b0a68483ac17f8eb0c4afff28f7`.
  - Source archive supplied in the reviewed childhood-arcade source distribution; revision recorded in its NATIVE_CORE_ORIGIN.json.
  - GPL-2.0; full license is archive `Copying`. No game/BIOS data included.
  - Build mirrors upstream Android defaults: RGB565, NTSC filter enabled, HD packs disabled.
- Oboe 1.9.3: https://github.com/google/oboe/tree/1.9.3
  - Download: https://codeload.github.com/google/oboe/tar.gz/refs/tags/1.9.3
  - SHA-256 `9d2486b74bd396d9d9112625077d5eb656fd6942392dc25ebf222b184ff4eb61`.
  - Apache-2.0; full license and notices are in the archive.

- FB Alpha 2012: https://github.com/libretro/fbalpha2012/tree/0ce31536bef3162fe7e69ff5f555334ec4913cef
  - Archive: `fbalpha2012-0ce31536.tar.gz`, supplied in the reviewed childhood-arcade source distribution.
  - SHA-256 `6825b86c65887fc92ba02c07059d8225113bcca7764dab84ce21da18954c33af`.
  - Non-commercial FBA license; full terms in archive `docs/license.txt`.
  - Source selection follows upstream Android.mk; portable CPU implementations, RGB565, ZIP/zlib.

The native state identities are `fceumm-e0f3086-native-v1` and `fbalpha2012-0ce3153-native-v1`. Change them when modifying
the core or build options in a way that can affect state compatibility. WASM states
remain separate. Release distributions must retain component licenses and provide
these corresponding sources and build instructions.

## Cartridge cores

- mGBA: https://github.com/libretro/mgba/tree/7a12d6d4b9acb14c0ae62c9166b6a2f3d08007f6
  - Archive: `mgba-7a12d6d4.tar.gz`, downloaded from https://codeload.github.com/libretro/mgba/tar.gz/7a12d6d4b9acb14c0ae62c9166b6a2f3d08007f6.
  - SHA-256: `5cbf639e527fb586bf33e14d59037eab35f78f45154e0b79c784fff474c3bc37`.
  - MPL-2.0; full terms in archive `LICENSE`. Upstream libretro CMake target with GB and GBA enabled, RGB565, no external dependencies or standalone frontends.
- Snes9x: https://github.com/libretro/snes9x/tree/204ea1c0b851f960cbf223075eb1c25641cb483c
  - Archive: `snes9x-204ea1c0.tar.gz`, downloaded from https://codeload.github.com/libretro/snes9x/tar.gz/204ea1c0b851f960cbf223075eb1c25641cb483c.
  - SHA-256: `506b07a775401f9357258fdae0fb0638a6e0f82093657d294aa51c046dcee67c`.
  - Non-commercial Snes9x license; full terms and component notices in archive `LICENSE`. Source list follows `libretro/Makefile.common` and Android definitions from `libretro/jni/Android.mk`.

`cartridge.cmake` builds `libmgba.so` and `libsnes9x.so` offline. Both share the existing libretro host, EGL renderer and Oboe audio engine. APK assets retain the licenses. Native state IDs are `mgba-7a12d6d4-native-v1` and `snes9x-204ea1c0-native-v1`.
