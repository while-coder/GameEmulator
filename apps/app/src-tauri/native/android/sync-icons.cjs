#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { generateNativeIcons } = require("../sync-icons.cjs");

const source = path.resolve(__dirname, "../../../../icon");
const resources = path.join(source, "android/res");

function syncIcons(android = path.resolve(__dirname, "../../gen/android")) {
  const artwork = fs.readdirSync(resources, { recursive: true }).sort()
    .map((file) => path.join(resources, file))
    .filter((file) => fs.statSync(file).isFile());
  const icons = generateNativeIcons("android", {
    inputs: [__filename, path.join(source, "android-foreground.png"), ...artwork],
    generate({ generated, output }) {
      const res = path.join(output, "res");
      fs.copyFileSync(path.join(generated, "icon.png"), path.join(output, "icon.png"));
      fs.cpSync(path.join(generated, "android"), res, { recursive: true });
      fs.cpSync(resources, res, { recursive: true });
      for (const qualifier of ["mipmap-anydpi-v26", "mipmap-anydpi-v33"]) {
        const directory = path.join(res, qualifier);
        fs.copyFileSync(path.join(directory, "ic_launcher.xml"), path.join(directory, "ic_launcher_round.xml"));
      }
    },
  });
  if (fs.existsSync(path.join(android, "settings.gradle"))) {
    fs.cpSync(path.join(icons, "res"), path.join(android, "app/src/main/res"), { recursive: true });
  }
  return icons;
}

module.exports = { syncIcons };
if (require.main === module) syncIcons();
