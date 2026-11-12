const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function load(path, globals, imports) {
  const source = readFileSync(resolve(__dirname, '..', path), 'utf8')
  const exports = {}
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  runInNewContext(outputText, { exports, require: name => { assert.ok(name in imports); return imports[name] }, ...globals })
  return exports
}

function setup(native, injected = null) {
  const mounted = [], cleanups = []
  const docListeners = new Map(), keyListeners = new Map()
  const document = {
    fullscreenElement: null,
    addEventListener: (key, fn) => docListeners.set(key, fn),
    removeEventListener: key => docListeners.delete(key),
    async exitFullscreen() { this.fullscreenElement = null; docListeners.get('fullscreenchange')() },
  }
  const target = { value: native ? { async requestFullscreen() { document.fullscreenElement = this; docListeners.get('fullscreenchange')() } } : {} }
  const shared = load('packages/player-ui/useFullscreen.ts', {
    document, window: { addEventListener: (key, fn) => keyListeners.set(key, fn), removeEventListener: key => keyListeners.delete(key) },
  }, { vue: { inject: () => injected, ref: value => ({ value }), onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanups.push(fn) } })
  for (const kind of ['nes', 'arcade']) {
    const api = load(`packages/${kind}/src/composables/useFullscreen.ts`, {}, { '../../../player-ui/useFullscreen': shared })
    assert.equal(api.useFullscreen, shared.useFullscreen)
  }
  const api = shared.useFullscreen(target)
  mounted.forEach(fn => fn())
  return { api, cleanups, docListeners, keyListeners }
}

test('shared fullscreen keeps native state in sync and removes listeners on unmount', async () => {
  const { api, cleanups, docListeners } = setup(true)
  assert.equal(api.usePseudo.value, false)
  await api.toggle()
  assert.equal(api.isFullscreen.value, true)
  await api.toggle()
  assert.equal(api.isFullscreen.value, false)
  cleanups.forEach(fn => fn())
  assert.equal(docListeners.size, 0)
})

test('shared fullscreen retains the pseudo fullscreen fallback and Esc exit', async () => {
  const { api, keyListeners } = setup(false)
  assert.equal(api.usePseudo.value, true)
  await api.enter()
  assert.equal(api.isFullscreen.value, true)
  keyListeners.get('keydown')({ key: 'Escape', preventDefault() {} })
  assert.equal(api.isFullscreen.value, false)
  assert.equal(keyListeners.size, 0)
})

test('shared fullscreen preserves the injected desktop implementation', () => {
  const injected = { platform: 'desktop' }
  const { api, docListeners } = setup(true, injected)
  assert.equal(api, injected)
  assert.equal(docListeners.size, 0)
})
