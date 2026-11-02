import { computed, ref } from 'vue'

const locale = ref(typeof navigator === 'undefined' ? 'en' : navigator.language)
export const appLocale = computed(() => {
  if (!/^zh(?:[-_]|$)/i.test(locale.value)) return 'en'
  return /^zh[-_](?:Hant|TW|HK|MO)(?:[-_]|$)/i.test(locale.value) ? 'zh-Hant' : 'zh-Hans'
})
export const appName = computed(() => ({
  en: 'GameEmulator',
  'zh-Hans': '游戏模拟器',
  'zh-Hant': '遊戲模擬器',
})[appLocale.value])

export function configureAppLocale(value?: string): void {
  if (value?.trim()) locale.value = value.trim()
}

export function configureAppBranding(tv = false): void {
  document.title = `${appName.value}${tv ? ' TV' : ''}`
  configureAppMetadata()
}

export function configureAppMetadata(): void {
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', appName.value)
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (manifest && appLocale.value !== 'en') {
    manifest.href = new URL(`manifest.${appLocale.value}.webmanifest`, manifest.href).href
  }
}
