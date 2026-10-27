import { getCachedCatalog, putCachedCatalog } from './library'

export interface CatalogFile {
  file_name: string
  download_url: string
  file_size: number
  sha256: string
  dependencies?: string[]
}
export interface CatalogGame extends CatalogFile {
  rom_name: string
  dependencies: string[]
}
export interface ArcadeCatalog {
  games: CatalogGame[]
  dependency_files: CatalogFile[]
}

export const DEFAULT_CATALOG_URLS = [
  'https://raw.githubusercontent.com/while-coder/arcade-roms/main/catalog.json',
  'https://raw.githubusercontent.com/while-coder/neogeo-roms/main/catalog.json',
]
const configuredUrls = String(import.meta.env.VITE_ARCADE_CATALOG_URLS ?? '').trim()
const catalogUrls = [...new Set(configuredUrls ? configuredUrls.split(/[\s,]+/).filter(Boolean) : DEFAULT_CATALOG_URLS)]
const loadedCatalogs = new Map<string, Promise<ArcadeCatalog>>()
const downloadBase = import.meta.env.VITE_ARCADE_ROM_URL_BASE?.trim()
const archiveName = /^[a-z0-9_+\-]+\.zip$/i

function remoteUrl(value: string, base = window.location.href): string {
  const url = new URL(value, base)
  if (url.protocol !== 'https:' && url.origin !== window.location.origin) throw new Error('目录和下载地址必须使用 HTTPS')
  if (url.username || url.password) throw new Error('目录和下载地址不能包含登录信息')
  return url.href
}

function parseCatalog(value: unknown, source: string): ArcadeCatalog {
  if (!value || typeof value !== 'object' || !('games' in value) || !Array.isArray(value.games)) throw new Error('游戏目录格式无效')
  const readFile = (value: unknown): CatalogFile => {
    if (!value || typeof value !== 'object') throw new Error('游戏目录文件信息无效')
    const file = value as CatalogFile
    validateCatalogFile(file)
    if (typeof file.download_url !== 'string' || !file.download_url.trim() ||
        (file.dependencies !== undefined && (!Array.isArray(file.dependencies) || file.dependencies.some(name => typeof name !== 'string' || !archiveName.test(name))))) {
      throw new Error(`游戏目录下载地址或依赖信息无效：${file.file_name}`)
    }
    return { ...file, sha256: file.sha256.toLowerCase(), download_url: remoteUrl(file.download_url, source) }
  }
  const games = value.games.map(value => {
    const file = readFile(value) as CatalogGame
    if (typeof file.rom_name !== 'string' || file.file_name !== `${file.rom_name}.zip` || !Array.isArray(file.dependencies)) throw new Error(`游戏目录缺少驱动或依赖信息：${file.file_name}`)
    return file
  })
  const dependencies = 'dependency_files' in value ? value.dependency_files : []
  if (!Array.isArray(dependencies)) throw new Error('游戏目录依赖列表无效')
  const catalog = { games, dependency_files: dependencies.map(readFile) }
  const files = new Map<string, CatalogFile>()
  for (const file of [...catalog.dependency_files, ...games]) {
    const existing = files.get(file.file_name)
    if (existing && (existing.sha256 !== file.sha256 || existing.file_size !== file.file_size)) throw new Error(`游戏目录存在冲突文件：${file.file_name}`)
    files.set(file.file_name, file)
  }
  for (const game of games) dependencyPlan(game, catalog)
  return catalog
}

async function readCatalog(url: string, signal?: AbortSignal): Promise<ArcadeCatalog> {
  signal?.throwIfAborted()
  const cached = await getCachedCatalog(url)
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 8_000)
  try {
    signal?.throwIfAborted()
    if (navigator.onLine === false) throw new Error('当前处于离线状态')
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const catalog = parseCatalog(await response.json(), url)
    signal?.throwIfAborted()
    // Cache only a fully validated manifest. A failed refresh must not replace
    // the last usable catalog or clear previously imported ROMs and snapshots.
    await putCachedCatalog({ url, catalog })
    return catalog
  } catch (error) {
    if (signal?.aborted) throw error
    if (cached) return parseCatalog(cached.catalog, url)
    const detail = abort.signal.aborted ? '连接超时' : error instanceof Error ? error.message : String(error)
    throw new Error(`读取游戏目录失败：${url}（${detail}）。首次使用需联网读取目录，请确认目录已发布。`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

function loadCatalog(source: string, signal?: AbortSignal): Promise<ArcadeCatalog> {
  const url = remoteUrl(source)
  let loading = loadedCatalogs.get(url)
  if (!loading) {
    loading = readCatalog(url, signal).catch(error => { loadedCatalogs.delete(url); throw error })
    loadedCatalogs.set(url, loading)
  }
  return loading
}

export async function findCatalogGame(hash: string, signal?: AbortSignal): Promise<{ game: CatalogGame; catalog: ArcadeCatalog } | undefined> {
  const results = await Promise.allSettled(catalogUrls.map(async url => loadCatalog(url, signal)))
  signal?.throwIfAborted()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const catalog = result.value
    const game = catalog.games.find(item => item.sha256.toLowerCase() === hash.toLowerCase())
    if (game) return { game, catalog }
  }
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

export function dependencyPlan(game: CatalogGame, catalog: ArcadeCatalog): CatalogFile[] {
  // A parent may itself be a game with dependencies. Preserve those edges even
  // when dependency_files also supplies the same archive's download metadata.
  const files = new Map<string, CatalogFile>()
  for (const file of [...catalog.dependency_files, ...catalog.games]) files.set(file.file_name, file)
  const result: CatalogFile[] = []
  const visited = new Set<string>(), visiting = new Set([game.file_name])
  function visit(name: string) {
    if (visiting.has(name)) throw new Error(`游戏目录存在循环依赖：${name}`)
    if (visited.has(name)) return
    const file = files.get(name)
    if (!file) throw new Error(`游戏目录缺少依赖信息：${name}`)
    validateCatalogFile(file)
    visiting.add(name)
    for (const dependency of file.dependencies ?? []) visit(dependency)
    visiting.delete(name); visited.add(name); result.push(file)
  }
  validateCatalogFile(game)
  for (const name of game.dependencies) visit(name)
  return result
}

export function validateCatalogFile(file: CatalogFile) {
  if (typeof file.file_name !== 'string' || !archiveName.test(file.file_name) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256) ||
      !Number.isSafeInteger(file.file_size) || file.file_size <= 0 || file.file_size > 128 * 1024 * 1024) {
    throw new Error(`游戏目录文件信息无效：${file.file_name}`)
  }
}

export function downloadUrl(file: CatalogFile): string {
  return remoteUrl(downloadBase ? `${downloadBase.replace(/\/+$/, '')}/${encodeURIComponent(file.file_name)}` : file.download_url)
}
