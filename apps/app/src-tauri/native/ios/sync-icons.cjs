#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { generateNativeIcons } = require("../sync-icons.cjs");

function syncIcons(apple = path.resolve(__dirname, "../../gen/apple")) {
  const icons = generateNativeIcons("ios", {
    inputs: [__filename],
    input: "icon-fullbleed.png",
    generate({ generated, output }) {
      fs.copyFileSync(path.join(generated, "icon.png"), path.join(output, "icon.png"));
      fs.cpSync(path.join(generated, "ios"), output, { recursive: true });
    },
  });
  const catalog = path.join(apple, "Assets.xcassets/AppIcon.appiconset");
  if (fs.existsSync(catalog)) {
    for (const file of fs.readdirSync(icons)) {
      if (file.startsWith("AppIcon-")) fs.copyFileSync(path.join(icons, file), path.join(catalog, file));
    }
  }
  return icons;
}

module.exports = { syncIcons };
if (require.main === module) syncIcons();
