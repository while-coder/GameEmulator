/** Resolve relative ROM paths once, when loading a catalog. */
export function catalogDownloadBase(source: string, romUrlBase?: unknown): string {
  const catalogUrl = new URL(source, typeof window === 'undefined' ? undefined : window.location.href)
  if (romUrlBase === undefined) return catalogUrl.href
  if (typeof romUrlBase !== 'string' || !romUrlBase.trim()) throw new Error('ROM 基础地址格式无效')
  const base = new URL(romUrlBase, catalogUrl)
  // rom_url_base always denotes a directory, including when its trailing slash is omitted.
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
  return base.href
}
