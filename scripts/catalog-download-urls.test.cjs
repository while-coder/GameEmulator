const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function load(file, imports = {}, globals = {}) {
  const source = readFileSync(resolve(__dirname, '..', file), 'utf8').replaceAll('import.meta.env', '__env')
  const exports = {}
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  runInNewContext(outputText, {
    exports, require: name => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name] },
    URL, AbortController, setTimeout, clearTimeout,
    window: { location: new URL('https://player.example/app/nes.html') }, ...globals,
  })
  return exports
}
const shared = load('packages/shared/romUrl.ts')
const sharedImport = { '../../../shared/romUrl': shared }
const encoded = '%E8%B6%85%E7%BA%A7%20Mario%231.nes'
const cdn = 'https://vm3-cdn.s3-us-west-2.amazonaws.com/test/roms/'

test('ROM bases support trailing slashes, relative directory bases, and catalog-relative fallback', () => {
  for (const base of [cdn, cdn.slice(0, -1)]) assert.equal(shared.catalogDownloadBase('https://catalog.example/catalog.json', base), cdn)
  assert.equal(shared.catalogDownloadBase('https://catalog.example/store/catalog.json', './roms'), 'https://catalog.example/store/roms/')
  assert.equal(shared.catalogDownloadBase('/store/catalog.json'), 'https://player.example/store/catalog.json')
  for (const invalid of [null, 42, '', '  ']) assert.throws(() => shared.catalogDownloadBase('https://catalog.example/catalog.json', invalid), /基础地址/)
})

function nesCatalog(data) {
  return load('packages/nes/src/store/romCatalog.ts', sharedImport, {
    fetch: async () => ({ ok: true, json: async () => structuredClone(data) }),
  })
}
const nesGame = url => ({ name: '测试游戏', download_url: url, sha256: 'a'.repeat(64), file_size: 16 })

test('NES resolves compact URLs without double-encoding filenames and preserves screenshot metadata', async () => {
  const data = { rom_url_base: cdn, games: [{ ...nesGame(encoded), screenshot_url: 'https://images.example/game.png' }] }
  const catalog = await nesCatalog(data).loadRomCatalog('https://catalog.example/catalog.json')
  assert.equal(catalog.games[0].download_url, cdn + encoded)
  assert.equal(catalog.games[0].screenshot_url, data.games[0].screenshot_url)
})

test('NES accepts old absolute URLs and resolves paths without a base against the catalog', async () => {
  const signed = 'https://github.com/files/game.nes?token=a%2Fb#keep'
  const old = await nesCatalog({ rom_url_base: cdn, games: [nesGame(signed)] }).loadRomCatalog('https://catalog.example/catalog.json')
  assert.equal(old.games[0].download_url, signed)
  const relative = await nesCatalog({ games: [nesGame('roms/game.nes')] }).loadRomCatalog('https://catalog.example/store/catalog.json')
  assert.equal(relative.games[0].download_url, 'https://catalog.example/store/roms/game.nes')
})

test('NES downloader permits the configured S3 host and continues rejecting unknown download hosts', async () => {
  const bytes = new Uint8Array(16); bytes.set([0x4e, 0x45, 0x53, 0x1a])
  const requests = []
  const api = load('packages/nes/src/store/romDownloader.ts', {}, {
    fetch: async url => { requests.push(url); return new Response(bytes) },
    Uint8Array, Response,
  })
  await api.downloadRom({ name: '测试游戏', download_url: cdn + encoded, file_size: 16 })
  assert.deepEqual(requests, [cdn + encoded])
  await assert.rejects(api.downloadRom({ name: '未知来源', download_url: 'https://unknown.example/game.nes' }), /未信任/)
  assert.equal(requests.length, 1)
})

function arcadeCatalog(data, { cache = new Map(), online = true, override } = {}) {
  return load('packages/arcade/src/store/catalog.ts', {
    ...sharedImport,
    './library': {
      getCachedCatalog: async url => cache.get(url),
      putCachedCatalog: async entry => cache.set(entry.url, entry),
    },
  }, {
    navigator: { onLine: online },
    __env: { VITE_ARCADE_CATALOG_URLS: 'https://catalog.example/arcade/catalog.json', VITE_ARCADE_ROM_URL_BASE: override },
    fetch: async () => ({ ok: true, json: async () => structuredClone(data) }),
  })
}
function arcadeData(base = cdn) {
  return {
    ...(base !== undefined && { rom_url_base: base }),
    games: [{ name: '街机', rom_name: 'game', file_name: 'game.zip', download_url: 'game.zip', sha256: 'A'.repeat(64), file_size: 100, dependencies: ['bios.zip'] }],
    dependency_files: [{ file_name: 'bios.zip', download_url: 'bios.zip', sha256: 'b'.repeat(64), file_size: 10 }],
  }
}

test('Arcade resolves both games and BIOS dependencies, including after loading cached catalogs offline', async () => {
  const cache = new Map()
  for (const online of [true, false]) {
    const api = arcadeCatalog(arcadeData(cdn.slice(0, -1)), { cache, online })
    const { catalogs, errors } = await api.loadCatalogs()
    assert.equal(errors.length, 0)
    const catalog = catalogs[0], game = catalog.games[0]
    assert.equal(api.downloadUrl(game), cdn + 'game.zip')
    assert.equal(api.downloadUrl(api.dependencyPlan(game, catalog)[0]), cdn + 'bios.zip')
    assert.equal(game.sha256, 'a'.repeat(64))
  }
})

test('Arcade preserves old absolute URLs and supports catalog-relative URLs when rom_url_base is absent', async () => {
  const data = arcadeData(); delete data.rom_url_base
  data.games[0].download_url = 'https://old.example/game.zip?key=a%2Fb'
  const api = arcadeCatalog(data)
  const { catalogs, errors } = await api.loadCatalogs()
  assert.equal(errors.length, 0)
  assert.equal(api.downloadUrl(catalogs[0].games[0]), data.games[0].download_url)
  assert.equal(api.downloadUrl(catalogs[0].dependency_files[0]), 'https://catalog.example/arcade/bios.zip')
})

test('Arcade keeps the explicit deployment override for both games and dependency files', async () => {
  const api = arcadeCatalog(arcadeData(), { override: 'https://override.example/roms/' })
  const { catalogs } = await api.loadCatalogs()
  assert.equal(api.downloadUrl(catalogs[0].games[0]), 'https://override.example/roms/game.zip')
  assert.equal(api.downloadUrl(catalogs[0].dependency_files[0]), 'https://override.example/roms/bios.zip')
})

test('Arcade rejects insecure or credential-bearing base URLs before caching a catalog', async () => {
  for (const base of ['http://unsafe.example/roms/', 'https://user:secret@unsafe.example/roms/']) {
    const cache = new Map(), api = arcadeCatalog(arcadeData(base), { cache })
    const result = await api.loadCatalogs()
    assert.equal(result.catalogs.length, 0)
    assert.equal(result.errors.length, 1)
    assert.equal(cache.size, 0)
  }
})
