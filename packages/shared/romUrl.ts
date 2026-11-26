/** Resolve the directory used by a catalog's relative asset paths. */
export function catalogAssetBase(source: string, baseUrl?: unknown): string {
  const catalogUrl = new URL(source, typeof window === 'undefined' ? undefined : window.location.href)
  if (baseUrl === undefined) return catalogUrl.href
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('资源基础地址格式无效')
  const base = new URL(baseUrl, catalogUrl)
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
  return base.href
}
