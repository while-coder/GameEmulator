import type { RomEntry } from './romCatalog'

export type DownloadProgress = {
  received: number
  total: number | null
  ratio: number | null
}

export type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void
}

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'raw.githubusercontent.com',
  'github.com',
  'youxi.s3.bitiful.net',
])

export async function downloadRom(
  entry: RomEntry,
  options: DownloadOptions = {},
): Promise<Uint8Array> {
  const url = resolveTrustedDownloadUrl(entry.download_url)
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new Error(`下载失败: 无法访问下载地址 (${networkErrorMessage(err)})`)
  }
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`)
  }

  const total = parseContentLength(response.headers.get('content-length')) ?? entry.file_size ?? null
  const bytes = response.body
    ? await readStream(response.body, total, options.onProgress)
    : new Uint8Array(await response.arrayBuffer())

  options.onProgress?.({ received: bytes.byteLength, total, ratio: 1 })
  await validateRomBytes(entry, bytes)
  return bytes
}

export async function validateRomBytes(entry: RomEntry, bytes: Uint8Array): Promise<void> {
  if (!isINes(bytes)) {
    throw new Error('文件不是有效的 iNES ROM')
  }
  if (entry.file_size !== undefined && bytes.byteLength !== entry.file_size) {
    throw new Error(`文件大小不匹配: ${bytes.byteLength} / ${entry.file_size}`)
  }
  if (entry.sha256) {
    const hash = await sha256Hex(bytes)
    if (hash !== entry.sha256.toLowerCase()) {
      throw new Error('SHA-256 校验失败')
    }
  }
}

function resolveTrustedDownloadUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url, window.location.href)
  } catch {
    throw new Error('下载地址格式无效')
  }
  if (parsed.origin === window.location.origin) {
    return parsed.toString()
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('下载地址必须使用 HTTPS')
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`未信任的下载来源: ${parsed.hostname}`)
  }
  return parsed.toString()
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  total: number | null,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.byteLength
    onProgress?.({
      received,
      total,
      ratio: total && total > 0 ? Math.min(received / total, 1) : null,
    })
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isINes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 16 &&
    bytes[0] === 0x4e &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x53 &&
    bytes[3] === 0x1a
  )
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('当前环境不支持 SHA-256 校验')
  }
  const input = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function networkErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
