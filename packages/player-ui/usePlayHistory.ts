import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { createPlaySession, loadPlayHistory, recordPlay, type GameSystem, type PlayHistory } from '../shared/playHistory'

function storage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}
const histories = new Map<GameSystem, ShallowRef<PlayHistory>>()
export function usePlayHistory(system: GameSystem) {
  let history = histories.get(system)
  if (!history) {
    history = shallowRef(loadPlayHistory(storage(), system))
    histories.set(system, history)
  }
  const state = history
  function update(key: string, at: number, elapsed: number) {
    state.value = { ...state.value, [key]: recordPlay(storage(), system, key, at, elapsed, state.value[key]) }
  }
  function refresh(event: StorageEvent) {
    if (!event.key || event.key.startsWith(`game-emulator:play-history:${system}:`)) state.value = loadPlayHistory(storage(), system)
  }
  onMounted(() => window.addEventListener('storage', refresh))
  onBeforeUnmount(() => window.removeEventListener('storage', refresh))
  return { history: state, update }
}

export function usePlaySession(system: GameSystem, gameKey: Ref<string | null>, playing: Ref<boolean>) {
  const { update } = usePlayHistory(system)
  const session = createPlaySession(update)
  const visible = ref(typeof document !== 'undefined' && !document.hidden)
  let trackedKey: string | null = null
  let closed = false
  function sync() {
    if (closed) return
    if (gameKey.value !== trackedKey) {
      trackedKey = gameKey.value
      if (trackedKey) session.start(trackedKey)
      else session.stop()
    }
    session.setRunning(playing.value && visible.value)
  }
  watch([gameKey, playing, visible], sync, { immediate: true, flush: 'sync' })
  const visibilityChange = () => { visible.value = !document.hidden }
  const pageHide = () => { closed = true; session.stop() }
  const pageShow = () => { closed = false; trackedKey = null; sync() }
  let interval: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    document.addEventListener('visibilitychange', visibilityChange)
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('pageshow', pageShow)
    interval = setInterval(() => session.flush(), 15_000)
  })
  onBeforeUnmount(() => {
    closed = true
    session.stop()
    clearInterval(interval)
    document.removeEventListener('visibilitychange', visibilityChange)
    window.removeEventListener('pagehide', pageHide)
    window.removeEventListener('pageshow', pageShow)
  })
}
