import type { Connect, Plugin } from 'vite'

const isolatePsp: Connect.NextHandleFunction = (request, response, next) => {
  const path = (request.url ?? '').split('?')[0]
  if (path.endsWith('/psp.html') || path.split('/').at(-1)?.startsWith('PPSSPPSDL')) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  }
  next()
}

export function pspIsolation(): Plugin {
  return {
    name: 'psp-isolation',
    configureServer: server => { server.middlewares.use(isolatePsp) },
    configurePreviewServer: server => { server.middlewares.use(isolatePsp) },
  }
}
