# Arcade core provenance

- Core: FB Alpha 2012, compatible with FBA 0.2.97.29 ROM sets.
- Runtime: RetroArch 1.22.2, upstream build reports Git a609b70.
- Pinned archive: https://raw.githubusercontent.com/arianrhodsandlot/retroarch-emscripten-build/v1.22.2/retroarch/fbalpha2012_libretro.zip
- Built by libretro; mirrored by the same build repository used by Nostalgist 0.21.1.
- Core source: https://github.com/libretro/fbalpha2012
- RetroArch source: https://github.com/libretro/RetroArch/tree/v1.22.2
- Core docs: https://docs.libretro.com/library/fbalpha2012/

SHA-256 of extracted files:

```
eba6a6074eb6c86d3ac640a3ee716461da188fb35e32de5c3b76ee18d032b80a  fbalpha2012_libretro.js
a19485f4060a3473c0229bd2bd4b68d5e13c1ecae65bb91728f7eaec3337afdb  fbalpha2012_libretro.wasm
```

Keep JS and WASM from the same archive. A core upgrade can invalidate snapshots: update CORE_BUILD in store/library.ts when upgrading. The binary assets are bundled and available offline; launching never fetches an unpinned core or a ZIP extraction library from a CDN.

FB Alpha's non-commercial license and RetroArch's GPLv3 text are included verbatim and also displayed in the arcade settings. No game ROMs or BIOS images are included.
