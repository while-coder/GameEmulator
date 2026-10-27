#!/usr/bin/env node
/**
 * 生成 SideStore / AltStore 源文件（apps.json）。
 *
 * 发布 workflow 会下载未签名 IPA，计算 sha256 与大小后调用本脚本生成
 * apps.json 并上传到 Release。用户在 SideStore 里添加下面的 sourceURL
 * 即可订阅并一键安装/更新（SideStore 会用用户自己的 Apple ID 重签）：
 *
 *   https://github.com/while-coder/nes-emulator/releases/latest/download/apps.json
 *
 * 环境变量：
 *   SIDESTORE_VERSION       版本号（必填）
 *   SIDESTORE_DOWNLOAD_URL  IPA 下载地址（必填）
 *   SIDESTORE_SHA256        IPA 的 sha256（必填）
 *   SIDESTORE_SIZE          IPA 字节大小（必填）
 *   SIDESTORE_NOTES         版本说明（可选）
 *   SIDESTORE_OUTPUT        输出文件（可选，缺省输出到 stdout）
 */
const fs = require("node:fs");

const REPO = "while-coder/nes-emulator";
const BUNDLE_ID = "com.while.nesemulator";
// releases/latest/download 是 GitHub 提供的稳定地址，始终指向最新 Release 的同名资源。
const SOURCE_URL = `https://github.com/${REPO}/releases/latest/download/apps.json`;
const ICON_URL = `https://raw.githubusercontent.com/${REPO}/main/apps/icon/icon.png`;
const WEBSITE = "https://while-coder.github.io/nes-emulator/";
const TINT_COLOR = "#C8102E";
const APP_NAME = "NES Emulator";
const DEFAULT_NOTES = "NES/FC 模拟器，支持触屏手柄与即时存档。";

const version = process.env.SIDESTORE_VERSION;
const downloadURL = process.env.SIDESTORE_DOWNLOAD_URL;
const sha256 = process.env.SIDESTORE_SHA256;
const size = Number(process.env.SIDESTORE_SIZE);
const notes = (process.env.SIDESTORE_NOTES || "").trim() || DEFAULT_NOTES;

for (const [name, value] of [["SIDESTORE_VERSION", version], ["SIDESTORE_DOWNLOAD_URL", downloadURL], ["SIDESTORE_SHA256", sha256]]) {
  if (!value) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(1);
  }
}
if (!Number.isFinite(size) || size <= 0) {
  console.error("SIDESTORE_SIZE 必须是正整数（IPA 字节大小）");
  process.exit(1);
}

// AltStore / SideStore 源格式：https://github.com/AltStore/AltStore/blob/main/Sources.md
const source = {
  name: APP_NAME,
  identifier: `${BUNDLE_ID}.source`,
  sourceURL: SOURCE_URL,
  iconURL: ICON_URL,
  website: WEBSITE,
  tintColor: TINT_COLOR,
  apps: [
    {
      name: APP_NAME,
      bundleIdentifier: BUNDLE_ID,
      developerName: "while",
      localizedDescription: "NES/FC 模拟器，支持触屏手柄与即时存档，可离线游玩。",
      iconURL: ICON_URL,
      tintColor: TINT_COLOR,
      category: "games",
      appID: BUNDLE_ID,
      versions: [
        {
          version,
          date: new Date().toISOString(),
          localizedDescription: notes,
          downloadURL,
          size,
          sha256,
        },
      ],
    },
  ],
};

const json = JSON.stringify(source, null, 2) + "\n";
const output = process.env.SIDESTORE_OUTPUT;
if (output) {
  fs.writeFileSync(output, json);
  console.log(`已生成 ${output}（v${version}，${size} 字节）`);
} else {
  process.stdout.write(json);
}
