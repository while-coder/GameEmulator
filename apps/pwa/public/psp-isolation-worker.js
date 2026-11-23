// GitHub Pages cannot configure response headers. Isolate the PSP document and
// its pthread bootstrap without applying COEP to the other emulator pages.
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (!url.pathname.endsWith('/psp.html') && !/\/PPSSPPSDL[^/]*\.js$/.test(url.pathname)) return
  event.respondWith(fetch(request).then(response => {
    if (!response.ok) return response
    const headers = new Headers(response.headers)
    headers.delete('Content-Encoding')
    headers.delete('Content-Length')
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }))
})
