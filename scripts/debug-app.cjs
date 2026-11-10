const { spawnSync } = require('node:child_process')
const { homedir } = require('node:os')
const path = require('node:path')

// GUI-launched editors may not inherit rustup's PATH setup from the shell.
const cargoBin = path.resolve(process.env.CARGO_HOME || path.join(homedir(), '.cargo'), 'bin')
const env = { ...process.env }
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
env[pathKey] = [env[pathKey], cargoBin].filter(Boolean).join(path.delimiter)

const result = spawnSync('cargo', [
  'build', '--manifest-path', 'apps/app/src-tauri/Cargo.toml',
], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.code === 'ENOENT'
    ? `找不到 cargo，请检查 Rust 安装及 CARGO_HOME（当前查找目录：${cargoBin}）。`
    : `无法启动 cargo：${result.error.message}`)
}
process.exitCode = result.status ?? 1
