import { cacheCatalog, loadCatalogWithFallback, readCatalogCache } from '../../../shared/catalogCache'
import { readVersionedCatalog, type RomMetadata } from '../../../shared/versionedCatalog'
import catalogUrl from '../../../../games/nes/catalog.json?url'

export type RomEntry = RomMetadata & { download_url: string; file_size?: number; sha256?: string; archive_size?: number }

export type RomCatalog = { updated_at?: string; base_url?: string; games: RomEntry[] }

export const DEFAULT_CATALOG_URL = new URL(catalogUrl, import.meta.url).href
const configuredCatalogUrl = import.meta.env.VITE_NES_CATALOG_URL?.trim() || DEFAULT_CATALOG_URL

async function requestCatalog(url: string, signal?: AbortSignal): Promise<unknown> {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.throwIfAborted()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 8_000)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal })
    if (!response.ok) throw new Error(`读取 ROM 目录失败: HTTP ${response.status}`)
    return await response.json()
  } catch (err) {
    if (signal?.aborted) throw err
    if (abort.signal.aborted) throw new Error('读取游戏目录超时，请稍后重试')
    throw new Error(`读取 ROM 目录失败: 无法访问 ${url} (${networkErrorMessage(err)})`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

const cacheKey = (url: string) => `nes:${url}`

function readCachedRomCatalog(url: string) {
  return readCatalogCache(cacheKey(url), value => parseCatalog(value, url))
}

async function loadAndCacheCatalog(url: string, signal?: AbortSignal) {
  const value = await requestCatalog(url, signal)
  const catalog = parseCatalog(value, url)
  signal?.throwIfAborted()
  await cacheCatalog(cacheKey(url), value, signal)
  signal?.throwIfAborted()
  return catalog
}

export function loadRomCatalog(url = configuredCatalogUrl, { signal }: { signal?: AbortSignal } = {}): Promise<RomCatalog> {
  return loadCatalogWithFallback(url, DEFAULT_CATALOG_URL,
    source => loadAndCacheCatalog(source, signal), readCachedRomCatalog, signal)
}

function parseCatalog(value: unknown, url: string): RomCatalog {
  const catalog = readVersionedCatalog(value, url)
  const games = catalog.games.map(({ metadata, version, downloadUrl }) => {
    const size = version.archive_size
    if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0)) throw new Error('ROM ZIP 大小无效')
    return { ...metadata, download_url: downloadUrl.href, file_size: version.size, sha256: version.sha256, archive_size: size }
  })
  // Keep the first record for a shared ROM hash and retain other names for search.
  return { updated_at: catalog.updatedAt, base_url: catalog.base, games: dedupeBySha256(games) }
}

function dedupeBySha256(games: RomEntry[]): RomEntry[] {
  const seen = new Map<string, RomEntry>()
  for (const game of games) {
    const key = romKey(game).toLowerCase()
    const previous = seen.get(key)
    if (previous) {
      previous.aliases = [...new Set([...(previous.aliases ?? []), game.name, ...(game.aliases ?? [])])]
        .filter(name => name !== previous.name)
    } else seen.set(key, game)
  }
  return [...seen.values()]
}

export function romKey(game: RomEntry): string {
  // loadRomCatalog 已强制每条目都有 sha256(见上方校验),故此处可安全断言非空。
  return game.sha256!
}

function networkErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
