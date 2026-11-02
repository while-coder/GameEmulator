#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { syncIcons } = require("./sync-icons.cjs");

function prepareIos(apple = path.resolve(__dirname, "../../gen/apple"), generate = true) {
  if (!fs.existsSync(path.join(apple, "Assets.xcassets/AppIcon.appiconset"))) {
    throw new Error("找不到 iOS 工程，请先运行 pnpm ios:init（需要 macOS）");
  }
  const project = fs.readFileSync(path.join(apple, "project.yml"), "utf8");
  const target = project.match(/^  ([\w-]+_iOS):\s*$/m)?.[1];
  if (!target) throw new Error("找不到 Tauri iOS 应用 target");
  // XcodeGen installs .lproj directories from target sources at the bundle root.
  fs.cpSync(path.join(__dirname, "locales"), path.join(apple, target), { recursive: true });
  if (generate) {
    syncIcons(apple);
    execFileSync("xcodegen", ["generate", "--spec", "project.yml"], { cwd: apple, stdio: "inherit" });
  }
  console.log("已配置 iOS 多语言显示名和工程图标");
}

module.exports = { prepareIos };
if (require.main === module) prepareIos();
