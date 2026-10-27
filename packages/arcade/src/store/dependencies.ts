import { dependencyPlan, downloadUrl, findCatalogGame, type CatalogFile } from './catalog'
import { hashBlob, importArchive, listArchives, putArchive, validateZip, type Archive } from './library'

export interface DependencyProgress {
  name: string
  received: number
  total: number
}
interface ResolveOptions {
  signal?: AbortSignal
  onProgress?: (progress: DependencyProgress) => void
}

async function downloadDependency(entry: CatalogFile, options: ResolveOptions): Promise<Archive> {
  const abort = new AbortController()
  let timeout = false
  let timer: ReturnType<typeof setTimeout>
  const resetTimeout = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { timeout = true; abort.abort() }, 30_000)
  }
  const cancel = () => abort.abort()
  options.signal?.throwIfAborted()
  options.signal?.addEventListener('abort', cancel, { once: true })
  const report = (received: number) => options.onProgress?.({ name: entry.file_name, received, total: entry.file_size })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    report(0); resetTimeout()
    const response = await fetch(downloadUrl(entry), { signal: abort.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let received = 0
    if (response.body) {
      reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > entry.file_size) throw new Error('文件大小超过目录记录')
        chunks.push(new Uint8Array(value)); report(received); resetTimeout()
      }
    } else {
      const bytes = await response.arrayBuffer()
      received = bytes.byteLength; chunks.push(new Uint8Array(bytes))
    }
    clearTimeout(timer!)
    if (received !== entry.file_size) throw new Error('文件大小与目录不符')
    const file = new File(chunks, entry.file_name, { type: 'application/zip' })
    await validateZip(file)
    if (await hashBlob(file) !== entry.sha256.toLowerCase()) throw new Error('SHA-256 校验失败')
    options.signal?.throwIfAborted()
    const archive = await importArchive(file, 'support')
    report(received)
    return archive
  } catch (error) {
    if (options.signal?.aborted) throw error
    const detail = timeout ? '连接超时' : error instanceof TypeError ? '无法访问下载源，请检查网络或下载源是否允许跨域访问' : error instanceof Error ? error.message : String(error)
    throw new Error(`下载依赖 ${entry.file_name} 失败：${detail}。请重试。`)
  } finally {
    clearTimeout(timer!)
    options.signal?.removeEventListener('abort', cancel)
    await reader?.cancel().catch(() => {})
    abort.abort()
  }
}

export async function prepareGame(game: Archive, options: ResolveOptions = {}): Promise<{ game: Archive; dependencies: Archive[] }> {
  const match = await findCatalogGame(game.hash, options.signal)
  if (!match) throw new Error(`${game.name} 未被游戏目录收录，无法自动确定依赖。请使用目录对应版本的游戏 ZIP。`)
  const plan = dependencyPlan(match.game, match.catalog)
  const cached = await listArchives()
  const dependencies: Archive[] = []
  for (const entry of plan) {
    options.signal?.throwIfAborted()
    const local = cached.find(file => file.hash === entry.sha256.toLowerCase() && file.size === entry.file_size)
    // Reuse a parent already imported as a game, as well as cached support ZIPs.
    // Verify its bytes before loading instead of relying only on the DB record.
    const archive = local && await hashBlob(local.file) === entry.sha256.toLowerCase()
      ? { ...local, name: entry.file_name }
      : await downloadDependency(entry, options)
    dependencies.push(archive)
  }
  options.signal?.throwIfAborted()
  const resolved = { ...game, name: match.game.file_name, dependencies: dependencies.map(file => file.name) }
  await putArchive(resolved)
  return { game: resolved, dependencies }
}
