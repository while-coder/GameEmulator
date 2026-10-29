#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { syncNativeIcons } = require("../apps/app/src-tauri/native/sync-icons.cjs");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "apps/icon");
const cli = require.resolve("@tauri-apps/cli/tauri.js", { paths: [path.join(root, "apps/app")] });
const webOnly = process.argv.includes("--web");

function generate(input, directory, sizes) {
  const output = path.join(root, ".tmp", directory);
  execFileSync(process.execPath, [cli, "icon", path.join(source, input), "--output", output,
    ...sizes.flatMap((size) => ["--png", String(size)])], { cwd: root, stdio: "inherit" });
  return output;
}

const browser = generate("icon.png", "browser-icons", [128, 192, 512]);
// iOS 主屏图标和 Android maskable 图标使用正式的不透明底图。
const maskable = generate("icon-fullbleed.png", "maskable-icons", [180, 512]);
// PWA 图标全部为生成产物,输出到 public/icons 并由 .gitignore 忽略。
const pwaIcons = path.join(root, "apps/pwa/public/icons");
fs.mkdirSync(pwaIcons, { recursive: true });
// 使用新的品牌文件名，避免浏览器继续命中旧版占位图标缓存。
for (const [from, to] of [["128x128.png", "gameemulator-favicon.png"], ["192x192.png", "gameemulator-192.png"], ["512x512.png", "gameemulator-512.png"]]) {
  fs.copyFileSync(path.join(browser, from), path.join(pwaIcons, to));
}
fs.copyFileSync(path.join(maskable, "180x180.png"), path.join(pwaIcons, "gameemulator-apple-touch-icon.png"));
fs.copyFileSync(path.join(maskable, "512x512.png"), path.join(pwaIcons, "gameemulator-maskable-512.png"));
const appPublic = path.join(root, "apps/app/public");
fs.mkdirSync(appPublic, { recursive: true });
fs.copyFileSync(path.join(browser, "128x128.png"), path.join(appPublic, "favicon.png"));

if (!webOnly) {
  for (const platform of ["windows", "linux", "android", "ios"]) syncNativeIcons(platform);
  if (process.platform === "darwin") syncNativeIcons("macos");
}
console.log(`已从 apps/icon 刷新${webOnly ? " Web" : "全部"}图标`);
