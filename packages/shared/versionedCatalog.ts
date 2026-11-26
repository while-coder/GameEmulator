import { catalogAssetBase } from './romUrl'

export type RomDetails = { version?: string; description?: string; screenshots?: string[]; source_url?: string }

export type RomMetadata = {
  name: string
  genre?: string
  publisher?: string
  tags?: string[]
  aliases?: string[]
  screenshot_url?: string
  group_id?: string
  group_name?: string
  group_default?: boolean
  group_description?: string
  group_screenshots?: string[]
  details?: RomDetails
}

type CatalogVersion = {
  name: string
  download_url: string
  size: number
  archive_size?: number
  sha256: string
  file_name?: string
  system?: string
  genre?: string
  publisher?: string
  tags?: string[]
  aliases?: string[]
  desc?: string
  screenshots?: string[]
  source_url?: string
}

type CatalogGame = {
  name: string
  name_en?: string
  system?: string
  desc?: string
  genre?: string
  publisher?: string
  screenshots?: string[]
  tags?: string[]
  aliases?: string[]
  source_url?: string
  versions: CatalogVersion[]
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.flatMap(item => text(item) ?? []) : []
}

function webUrl(value: unknown, base: string) {
  const path = text(value)
  if (!path) return
  try {
    const url = new URL(path, base)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch { /* Ignore malformed optional URLs. */ }
}

export function readVersionedCatalog(value: unknown, source: string) {
  const catalog = value as { games?: CatalogGame[]; base_url?: string; updated_at?: string; dependency_files?: unknown[] } | null
  if (!Array.isArray(catalog?.games)) throw new Error('游戏目录缺少 games 数组')
  const base = catalogAssetBase(source, catalog.base_url)
  const games = catalog.games.flatMap(game => {
    if (!game || !text(game.name) || !Array.isArray(game.versions) || !game.versions.length) {
      throw new Error('游戏目录缺少名称或版本')
    }
    for (const version of game.versions) {
      if (!version || !text(version.name) || !text(version.download_url)
        || typeof version.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(version.sha256)
        || !Number.isSafeInteger(version.size) || version.size <= 0) throw new Error('游戏目录版本信息无效')
    }
    const groupId = game.versions.length > 1 ? game.versions[0].sha256.toLowerCase() : undefined
    const sharedScreenshots = strings(game.screenshots).flatMap(image => webUrl(image, base) ?? [])
    const sharedTags = strings(game.tags)
    const sharedAliases = [...strings(game.aliases), ...strings([game.name_en])]
    return game.versions.map((version, index) => {
      const screenshots = strings(version.screenshots).flatMap(image => webUrl(image, base) ?? [])
      const metadata: RomMetadata = {
        name: groupId ? `${game.name} ${version.name}` : game.name,
        genre: text(version.genre) ?? text(game.genre),
        publisher: text(version.publisher) ?? text(game.publisher),
        tags: [...new Set([...sharedTags, ...strings(version.tags)])],
        aliases: [...new Set([...sharedAliases, ...strings(version.aliases)])],
        group_id: groupId,
        group_name: game.name,
        group_default: index === 0,
        group_description: text(game.desc),
        group_screenshots: sharedScreenshots,
        screenshot_url: screenshots[0],
        details: {
          version: version.name,
          description: text(version.desc),
          screenshots,
          source_url: webUrl(version.source_url, source) ?? webUrl(game.source_url, source),
        },
      }
      return { metadata, version, system: version.system ?? game.system, downloadUrl: new URL(version.download_url, base) }
    })
  })
  return { base, games, updatedAt: catalog.updated_at, dependencyFiles: catalog.dependency_files }
}
