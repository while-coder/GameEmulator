#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { syncIcons } = require("./sync-icons.cjs");

function prepareIos(apple = path.resolve(__dirname, "../../gen/apple")) {
  if (!fs.existsSync(path.join(apple, "Assets.xcassets/AppIcon.appiconset"))) {
    throw new Error("找不到 iOS 工程，请先运行 pnpm ios:init（需要 macOS）");
  }
  syncIcons(apple);
  console.log("已同步 iOS 工程图标");
}

module.exports = { prepareIos };
if (require.main === module) prepareIos();
