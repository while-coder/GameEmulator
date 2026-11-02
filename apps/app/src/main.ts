import { appName, mountShell } from '@game-emulator/shell'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import App from './App.vue'
mountShell(App)
if (isTauri()) {
  void getCurrentWindow().setTitle(appName.value).catch(error => console.warn('无法设置窗口标题', error))
}
