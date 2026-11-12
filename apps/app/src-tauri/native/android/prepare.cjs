#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { syncIcons } = require("./sync-icons.cjs");

function prepareAndroid(android = path.resolve(__dirname, "../../gen/android")) {
  if (!fs.existsSync(path.join(android, "settings.gradle"))) {
    throw new Error("找不到 Android 工程，请先运行 pnpm android:init");
  }
  fs.cpSync(path.join(__dirname, "app"), path.join(android, "app"), { recursive: true });
  const settings = path.join(android, "settings.gradle");
  const nativeModule = path.relative(android, path.resolve(__dirname, "../../../../../packages/android-native/android")).replaceAll("\\", "/");
  const marker = "// game-emulator-native";
  let content = fs.readFileSync(settings, "utf8");
  content = content.replace(/\n\/\/ game-emulator-native[\s\S]*?\/\/ end-game-emulator-native\n?/g, "\n");
  fs.writeFileSync(settings, `${content.trimEnd()}\n${marker}\ninclude ':emulator-native'\nproject(':emulator-native').projectDir = new File(settingsDir, '${nativeModule}')\n// Keep dependency build outputs out of read-only Cargo registry/source directories.\ngradle.beforeProject { p ->\n    if (p != p.rootProject && !p.projectDir.toPath().startsWith(p.rootDir.toPath())) {\n        p.layout.buildDirectory.set(p.rootProject.layout.buildDirectory.dir("dependencies/" + p.name))\n    }\n}\n// end-game-emulator-native\n`);
  syncIcons(android);
  console.log("已配置 Android 签名、返回键、TV 支持、应用内更新、显示名和启动图标");
}

module.exports = { prepareAndroid };
if (require.main === module) prepareAndroid();
