import { onBeforeUnmount, ref, shallowRef } from 'vue'

type Operation = { name: string; action: 'play' | 'download'; controller: AbortController }

export function useLibraryOperation() {
  const operation = shallowRef<Operation | null>(null)
  const cancelling = ref(false)
  function cancelOperation() {
    if (!operation.value || cancelling.value) return
    cancelling.value = true
    operation.value.controller.abort()
  }
  async function runOperation(name: string, action: Operation['action'], run: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController()
    operation.value = { name, action, controller }
    cancelling.value = false
    try {
      await run(controller.signal)
      controller.signal.throwIfAborted()
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      operation.value = null
      cancelling.value = false
    }
  }
  onBeforeUnmount(cancelOperation)
  return { operation, cancelling, cancelOperation, runOperation }
}
