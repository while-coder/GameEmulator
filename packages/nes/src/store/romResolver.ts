/**
 * 按 sha256 找回 ROM 字节:读档时若对应游戏尚未载入,据存档绑定的 sha256
 * 先查本地缓存,缓存未命中再到在线目录匹配并下载。找不到则返回 null,
 * 由调用方弹窗报错。
 */
import { loadRomCatalog, type RomEntry } from './romCatalog'
import { downloadRom, validateRomBytes, type DownloadOptions } from './romDownloader'
import { getCachedRom, saveCachedRom } from './romLibrary'

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
  known?: RomEntry,
): Promise<ResolvedRom | null> {
  const key = sha256.toLowerCase()

  options.signal?.throwIfAborted()
  const cached = await getCachedRom(sha256) ?? (sha256 === key ? null : await getCachedRom(key))
  options.signal?.throwIfAborted()
  if (cached) {
    try {
      await validateRomBytes({ name: cached.name, file_size: cached.size, sha256: key, download_url: '' }, cached.bytes)
      return { name: cached.name, bytes: cached.bytes }
    } catch {
      // A damaged cached file can be replaced by the verified download below.
      options.signal?.throwIfAborted()
    }
  }

  const matches = (game: RomEntry) => game.sha256?.toLowerCase() === key
  const entry = known && matches(known) && known.download_url ? known
    : (await loadRomCatalog(undefined, { signal: options.signal })).games.find(matches)
  if (!entry) return null

  const bytes = await downloadRom(entry, options)
  options.signal?.throwIfAborted()
  await saveCachedRom(entry, bytes)
  return { name: entry.name, bytes }
}
