# PPSSPP Web

The bundled SDL build is PPSSPP 1.20.4-wasm, distributed by the PPSSPP Web project.
The upstream deployment reported revision
`21294328817e37a12b7620aa016d8535166c73b282330a937c49d122467e604e`.
The three files under its `build-wasm/` directory are bundled together and
loaded on demand when a PSP game starts.

- [PPSSPP Web build and packaging sources](https://github.com/root-hunter/ppsspp-web)
- [PPSSPP WASM source](https://github.com/root-hunter/ppsspp-wasm)
- [Upstream distribution](https://root-hunter.github.io/ppsspp-web/)
- [License](PPSSPP-LICENSE.txt)

| File | SHA-256 |
| --- | --- |
| `PPSSPPSDL.js` | `a5fe3c77961d8609c6337e7174dc6bce5fc7809bd023be9e0dc820864fb1d000` |
| `PPSSPPSDL.wasm` | `88111ce288230617f0f1589bdca16980d4d750af96a2ffff9418ef47db32a157` |
| `PPSSPPSDL.data` | `87076b1c68519a2bf03e347f8a16222521f06beca9f3fc74d8743f968eb2c5da` |

The PSP entry requires WebGL and a cross-origin-isolated context for WASM
threads. The dev/preview servers and Android TV asset server set COOP and COEP
for the PSP page and worker. The web build also sets those headers through its
service worker on hosts without access to response configuration. Game images
are loaded into memory, so the practical image-size limit depends on the device.
