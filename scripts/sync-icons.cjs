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

const browser = generate("icon.png", "browser-icons", [128, 256, 512]);
const maskable = generate("icon-fullbleed.png", "maskable-icons", [512]);
const pwa = path.join(root, "apps/pwa/public");
fs.mkdirSync(pwa, { recursive: true });
for (const [from, to] of [["128x128.png", "favicon.png"], ["256x256.png", "pwa-256.png"], ["512x512.png", "icon-512.png"]]) {
  fs.copyFileSync(path.join(browser, from), path.join(pwa, to));
}
fs.copyFileSync(path.join(maskable, "512x512.png"), path.join(pwa, "icon-maskable-512.png"));
const appPublic = path.join(root, "apps/app/public");
fs.mkdirSync(appPublic, { recursive: true });
fs.copyFileSync(path.join(browser, "128x128.png"), path.join(appPublic, "favicon.png"));

if (!webOnly) {
  for (const platform of ["windows", "linux", "android", "ios"]) syncNativeIcons(platform);
  if (process.platform === "darwin") syncNativeIcons("macos");
}
console.log(`已从 apps/icon 刷新${webOnly ? " Web" : "全部"}图标`);
