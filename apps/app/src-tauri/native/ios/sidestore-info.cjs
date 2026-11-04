#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function readAppInfo() {
  const root = path.resolve(__dirname, "../../../../..");
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const config = readJson("apps/app/src-tauri/tauri.conf.json");
  const ios = readJson("apps/app/src-tauri/tauri.ios.conf.json");
  const version = readJson("package.json").version;
  const plist = fs.readFileSync(path.join(__dirname, "Info.plist"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "");
  const decodeXml = (value) => value.replace(/&(amp|lt|gt|quot|apos);/g,
    (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]);
  const privacy = Object.fromEntries(
    [...plist.matchAll(/<key>(NS[^<]*UsageDescription[^<]*)<\/key>\s*<string>([\s\S]*?)<\/string>/g)]
      .map(([, key, value]) => [key, decodeXml(value)]),
  );
  return {
    name: config.productName,
    bundleIdentifier: ios.identifier ?? config.identifier,
    developerName: "while-coder",
    localizedDescription: "多平台游戏模拟器，支持 NES/FC、街机、触屏手柄与即时存档，可离线游玩。",
    category: "games",
    tintColor: "#C8102E",
    version,
    // CI does not pass --build-number; Tauri defaults CFBundleVersion to the app version.
    buildVersion: ios.bundle?.iOS?.bundleVersion ?? config.bundle?.iOS?.bundleVersion ?? version,
    minOSVersion: ios.bundle?.iOS?.minimumSystemVersion ?? config.bundle?.iOS?.minimumSystemVersion,
    // This app has no custom signing entitlements or app extensions.
    appPermissions: { entitlements: [], privacy },
  };
}

module.exports = { readAppInfo };
if (require.main === module) console.log(JSON.stringify(readAppInfo(), null, 2));
