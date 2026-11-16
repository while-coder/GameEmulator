import { catalogDownloadBase } from '../../../shared/romUrl'
import { createGameSearch } from '../../../shared/gameText'

export type RomEntry = {
  name: string
  screenshot_url?: string
  genre?: string
  publisher?: string
  tags?: string[]
  download_url: string
  file_size?: number
  sha256?: string
  mapper?: number
}

export type RomCatalog = {
  updated_at?: string
  rom_url_base?: string
  games: RomEntry[]
}

// ROM 目录运行时从远程加载(web/app 均不打包进产物);切换源改此处即可。
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/while-coder/nes-roms/main/catalog.json'

export function emptyRomCatalog(): RomCatalog {
  return {
    games: [],
  }
}

async function requestCatalog(url: string, signal?: AbortSignal): Promise<RomCatalog> {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  signal?.throwIfAborted()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 8_000)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal })
    if (!response.ok) throw new Error(`读取 ROM 目录失败: HTTP ${response.status}`)
    return await response.json() as RomCatalog
  } catch (err) {
    if (signal?.aborted) throw err
    if (abort.signal.aborted) throw new Error('读取游戏目录超时，请稍后重试')
    throw new Error(`读取 ROM 目录失败: 无法访问 ${url} (${networkErrorMessage(err)})`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export async function loadRomCatalog(url = DEFAULT_CATALOG_URL, options: { signal?: AbortSignal } = {}): Promise<RomCatalog> {
  const catalog = await requestCatalog(url, options.signal)
  if (!Array.isArray(catalog.games)) {
    throw new Error('ROM 目录格式无效')
  }
  const downloadBase = catalogDownloadBase(url, catalog.rom_url_base)
  for (const game of catalog.games) {
    if (!game.name || !game.download_url || !game.sha256 || typeof game.file_size !== 'number') {
      throw new Error('ROM 目录缺少必要字段')
    }
    game.download_url = new URL(game.download_url, downloadBase).href
  }
  // 远程目录可能存在 sha256 相同的重复条目(同一 ROM 内容多次收录)。
  // sha256 同时是 romKey / 缓存键,重复会导致 v-for key 冲突且无法区分,
  // 故按 sha256 去重,保留首次出现的条目。
  catalog.games = dedupeBySha256(catalog.games)
  return catalog
}

function dedupeBySha256(games: RomEntry[]): RomEntry[] {
  const seen = new Set<string>()
  return games.filter((game) => {
    const key = game.sha256!
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function listGenres(games: RomEntry[]): string[] {
  return Array.from(new Set(games.map((game) => game.genre).filter(Boolean) as string[])).sort(
    (a, b) => a.localeCompare(b, 'zh-Hans-CN'),
  )
}

export function searchRoms(
  games: RomEntry[],
  query: string,
  genre: string,
  downloadedOnly: boolean,
  cachedKeys: Set<string>,
): RomEntry[] {
  const matches = createGameSearch(query)
  return games.filter((game) => {
    if (downloadedOnly && !cachedKeys.has(romKey(game))) return false
    if (genre && game.genre !== genre) return false
    return matches([game.name, game.genre, game.publisher, game.mapper, ...(game.tags ?? [])])
  })
}

export function romKey(game: RomEntry): string {
  // loadRomCatalog 已强制每条目都有 sha256(见上方校验),故此处可安全断言非空。
  return game.sha256!
}

function networkErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
