import { getCachedCatalog, putCachedCatalog } from './library'
import { readVersionedCatalog, type RomMetadata } from '../../../shared/versionedCatalog'
import arcadeCatalog from '../../../../games/arcade/catalog.json?url'
import neogeoCatalog from '../../../../games/neogeo/catalog.json?url'

export interface CatalogFile {
  file_name: string
  download_url: string
  file_size: number
  sha256: string
  dependencies?: string[]
}
export interface CatalogGame extends CatalogFile, Partial<RomMetadata> {
  name_en?: string
  system?: string
  rom_name: string
  dependencies: string[]
}
export interface ArcadeCatalog {
  base_url?: string
  games: CatalogGame[]
  dependency_files: CatalogFile[]
}

export const DEFAULT_CATALOG_URLS = [
  new URL(arcadeCatalog, import.meta.url).href,
  new URL(neogeoCatalog, import.meta.url).href,
]
const legacyUrls = [...new Set(String(import.meta.env.VITE_ARCADE_CATALOG_URLS ?? '').split(/[\s,]+/).filter(Boolean))]
const catalogSources = [
  { url: import.meta.env.VITE_ARCADE_CATALOG_URL?.trim() || legacyUrls[0] || DEFAULT_CATALOG_URLS[0], packaged: DEFAULT_CATALOG_URLS[0] },
  { url: import.meta.env.VITE_NEOGEO_CATALOG_URL?.trim() || legacyUrls[1] || DEFAULT_CATALOG_URLS[1], packaged: DEFAULT_CATALOG_URLS[1] },
  ...legacyUrls.slice(2).map(url => ({ url })),
]
type CatalogSource = { url: string; packaged?: string }
interface CatalogResult { catalog: ArcadeCatalog; error?: string }
const loadedCatalogs = new Map<CatalogSource, Promise<CatalogResult>>()
const downloadBase = import.meta.env.VITE_ARCADE_ROM_URL_BASE?.trim()
const archiveName = /^[a-z0-9_+\-]+\.zip$/i

function remoteUrl(value: string, base = window.location.href): string {
  const url = new URL(value, base)
  if (url.protocol !== 'https:' && !DEFAULT_CATALOG_URLS.includes(url.href)
      && (url.protocol !== 'http:' || url.origin !== window.location.origin)) throw new Error('目录和下载地址必须使用 HTTPS')
  if (url.username || url.password) throw new Error('目录和下载地址不能包含登录信息')
  return url.href
}

function parseCatalog(value: unknown, source: string): ArcadeCatalog {
  const manifest = readVersionedCatalog(value, source)
  const base = remoteUrl(manifest.base)
  const readFile = (value: unknown): CatalogFile => {
    if (!value || typeof value !== 'object') throw new Error('游戏目录文件信息无效')
    const { size, ...fields } = value as Omit<CatalogFile, 'file_size'> & { size: number }
    const file = { ...fields, file_size: size }
    validateCatalogFile(file)
    if (typeof file.download_url !== 'string' || !file.download_url.trim() ||
        (file.dependencies !== undefined && (!Array.isArray(file.dependencies) || file.dependencies.some(name => typeof name !== 'string' || !archiveName.test(name))))) {
      throw new Error(`游戏目录下载地址或依赖信息无效：${file.file_name}`)
    }
    return { ...file, sha256: file.sha256.toLowerCase(), download_url: remoteUrl(file.download_url, base) }
  }
  const games = manifest.games.map(({ version, metadata, system }) => {
    const file = { ...readFile(version), ...metadata, system } as CatalogGame
    if (typeof file.rom_name !== 'string' || file.file_name !== `${file.rom_name}.zip` || !Array.isArray(file.dependencies)) throw new Error(`游戏目录缺少驱动或依赖信息：${file.file_name}`)
    return file
  })
  const dependencies = manifest.dependencyFiles === undefined ? [] : manifest.dependencyFiles
  if (!Array.isArray(dependencies)) throw new Error('游戏目录依赖列表无效')
  const catalog: ArcadeCatalog = { base_url: base, games, dependency_files: dependencies.map(readFile) }
  const files = new Map<string, CatalogFile>()
  for (const file of [...catalog.dependency_files, ...games]) {
    const existing = files.get(file.file_name)
    if (existing && (existing.sha256 !== file.sha256 || existing.file_size !== file.file_size)) throw new Error(`游戏目录存在冲突文件：${file.file_name}`)
    files.set(file.file_name, file)
  }
  for (const game of games) dependencyPlan(game, catalog)
  return catalog
}

async function readCachedCatalog(url: string): Promise<ArcadeCatalog | undefined> {
  try {
    const source = remoteUrl(url)
    const cached = await getCachedCatalog(source)
    if (cached?.manifest) return parseCatalog(cached.manifest, source)
  } catch { /* A bad cache entry must not block a network refresh. */ }
}

async function refreshCatalog(source: string, signal?: AbortSignal): Promise<ArcadeCatalog> {
  signal?.throwIfAborted()
  const url = remoteUrl(source)
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 8_000)
  try {
    if (navigator.onLine === false && !DEFAULT_CATALOG_URLS.includes(url)) throw new Error('当前处于离线状态')
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest: unknown = await response.json()
    const catalog = parseCatalog(manifest, url)
    signal?.throwIfAborted()
    // Cache only a fully validated manifest. A failed refresh must not replace
    // the last usable catalog or clear previously imported ROMs and snapshots.
    try {
      await putCachedCatalog({ url, catalog, manifest })
    } catch (error) {
      if (!DEFAULT_CATALOG_URLS.includes(url)) throw error
    }
    signal?.throwIfAborted()
    return catalog
  } catch (error) {
    if (signal?.aborted) throw error
    const detail = abort.signal.aborted ? '连接超时' : error instanceof Error ? error.message : String(error)
    throw new Error(`读取游戏目录失败：${url}（${detail}）`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

async function readCatalog({ url, packaged }: CatalogSource, signal?: AbortSignal): Promise<CatalogResult> {
  let failure: unknown
  try {
    const catalog = await refreshCatalog(url, signal)
    if (url === packaged) return { catalog }
  } catch (error) {
    signal?.throwIfAborted()
    failure = error
  }
  const cached = await readCachedCatalog(url)
  signal?.throwIfAborted()
  const error = failure instanceof Error ? failure.message : failure === undefined ? undefined : String(failure)
  if (cached) return { catalog: cached, error }
  if (!packaged || url === packaged) throw failure ?? new Error('无法读取已缓存的游戏目录')

  try {
    return { catalog: await refreshCatalog(packaged, signal), error }
  } catch (packagedError) {
    signal?.throwIfAborted()
    const cachedPackaged = await readCachedCatalog(packaged)
    signal?.throwIfAborted()
    if (cachedPackaged) return { catalog: cachedPackaged, error }
    throw packagedError
  }
}

function loadCatalog(source: CatalogSource, signal?: AbortSignal): Promise<CatalogResult> {
  let loading = loadedCatalogs.get(source)
  if (!loading) {
    loading = readCatalog(source, signal).catch(error => {
      if (loadedCatalogs.get(source) === loading) loadedCatalogs.delete(source)
      throw error
    })
    loadedCatalogs.set(source, loading)
  }
  return loading
}

export async function loadCatalogs(signal?: AbortSignal, refresh = false) {
  if (refresh) loadedCatalogs.clear()
  const results = await Promise.allSettled(catalogSources.map(source => loadCatalog(source, signal)))
  signal?.throwIfAborted()
  return {
    catalogs: results.flatMap(result => result.status === 'fulfilled' ? [result.value.catalog] : []),
    errors: results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : result.value.error ? [result.value.error] : []),
    incomplete: results.some(result => result.status === 'rejected'),
  }
}

export async function findCatalogGame(hash: string, signal?: AbortSignal): Promise<{ game: CatalogGame; catalog: ArcadeCatalog } | undefined> {
  const results = await Promise.allSettled(catalogSources.map(source => loadCatalog(source, signal)))
  signal?.throwIfAborted()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const catalog = result.value.catalog
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
