import { ref, watch } from 'vue'

const SETTINGS_TABS = ['saves', 'keys', 'display', 'audio', 'misc'] as const
type SettingsTab = typeof SETTINGS_TABS[number]

export function useSettingsTab(system: 'nes' | 'arcade') {
  const storageKey = `${system}:settingsTab`
  let initial: SettingsTab = 'saves'
  try {
    const saved = localStorage.getItem(storageKey)
    if (SETTINGS_TABS.includes(saved as SettingsTab)) initial = saved as SettingsTab
  } catch {}

  const tab = ref<SettingsTab>(initial)
  watch(tab, value => {
    try { localStorage.setItem(storageKey, value) } catch {}
  }, { flush: 'sync' })
  return tab
}
