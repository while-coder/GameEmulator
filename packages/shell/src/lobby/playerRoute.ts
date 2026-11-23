import type { PlayerEntry } from '../../../player-ui/playerEntry'
import { emulators, type EmulatorId } from '../registry'

export function openPlayerPage(system: EmulatorId, entry?: PlayerEntry) {
  const emulator = emulators.find(item => item.id === system)
  if (!emulator) throw new Error('不支持的模拟器入口')
  const url = new URL(emulator.page, location.href)
  if (entry?.kind === 'settings') url.searchParams.set('view', 'settings')
  else if (entry) {
    url.searchParams.set('game', entry.key)
    url.searchParams.set('name', entry.name)
    if (entry.saveKey) url.searchParams.set('save', entry.saveKey)
  }
  location.replace(url.href)
}

export function playerEntry(): PlayerEntry | undefined {
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
  const key = params.get('game')
  if (view === 'settings') return { kind: 'settings' }
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) return
  const saveKey = params.get('save') ?? undefined
  if (saveKey !== undefined && (!saveKey || saveKey.length > 8192)) return
  return { kind: 'play', key, name: params.get('name')?.slice(0, 180) || '游戏', saveKey }
}

export function returnToLobby() {
  location.replace(new URL('index.html', location.href).href)
}
