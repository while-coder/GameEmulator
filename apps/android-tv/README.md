# Android TV

The standalone TV APK uses GeckoView for the existing Vue UI and the shared
[Android native backend](../../packages/android-native/README.md) for NES/FC and arcade.
It packages ARM32 and ARM64 FCEUmm, FB Alpha 2012 and host `.so` libraries.

```sh
pnpm build:android-tv
pnpm test:android-tv
```

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
The `.debug` package can coexist with a release installation.

The ordinary Tauri Android APK uses the same native backend through its WebView
adapter. Desktop, iOS and PWA keep their WASM implementations. See the shared
backend README for build requirements, save compatibility and device acceptance.
