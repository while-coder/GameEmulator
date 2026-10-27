/**
 * 按 sha256 找回 ROM 字节:读档时若对应游戏尚未载入,据存档绑定的 sha256
 * 先查本地缓存,缓存未命中再到在线目录匹配并下载。找不到则返回 null,
 * 由调用方弹窗报错。
 */
import { loadRomCatalog } from './romCatalog'
import { downloadRom, type DownloadOptions } from './romDownloader'
import { getCachedRom, saveCachedRom, touchCachedRom } from './romLibrary'

export type ResolvedRom = {
  name: string
  bytes: Uint8Array
}

/**
 * 据 sha256 取得 ROM:缓存优先,其次在线目录下载并写入缓存。
 * 返回 null 表示缓存与在线目录都没有这份 ROM。
 */
export async function acquireRomByKey(
  sha256: string,
  options: DownloadOptions = {},
): Promise<ResolvedRom | null> {
  const key = sha256.toLowerCase()

  const cached = await getCachedRom(key)
  if (cached) {
    await touchCachedRom(key)
    return { name: cached.name, bytes: cached.bytes }
  }

  const catalog = await loadRomCatalog()
  const entry = catalog.games.find((game) => game.sha256?.toLowerCase() === key)
  if (!entry) return null

  const bytes = await downloadRom(entry, options)
  await saveCachedRom(entry, bytes)
  await touchCachedRom(key)
  return { name: entry.name, bytes }
}
