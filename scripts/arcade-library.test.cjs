const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../packages/arcade/src/store/library.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})

function library(stores) {
  const exports = {}
  runInNewContext(outputText, {
    exports, Blob,
    require: () => ({}),
    fetch() { assert.fail('Reading downloaded game names must not request the network') },
    indexedDB: {
      open() {
        const request = {}
        queueMicrotask(() => {
          request.result = {
            transaction(name) {
              const tx = {
                objectStore() {
                  return { getAll() {
                    const read = {}
                    queueMicrotask(() => {
                      read.result = structuredClone(stores[name] ?? [])
                      read.onsuccess()
                      queueMicrotask(() => tx.oncomplete())
                    })
                    return read
                  } }
                },
              }
              return tx
            },
          }
          request.onsuccess()
        })
        return request
      },
    },
  })
  return exports
}

const archive = { id: 'game:kod.zip', name: 'kod.zip', hash: 'ABC', kind: 'game', file: new Uint8Array([1, 2, 3]).buffer }

test('legacy downloads recover game names from local catalogs without network access', async () => {
  const api = library({ archives: [archive], catalogs: [{ catalog: { games: [{ sha256: 'abc', name: '龙王战士' }] } }] })
  const [game] = await api.listArchives()
  assert.equal(game.displayName, '龙王战士')
  assert.equal(game.name, 'kod.zip') // The emulator still needs the original filename.
  assert.deepEqual(new Uint8Array(await game.file.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test('persisted display names survive missing catalogs', async () => {
  const [game] = await library({ archives: [{ ...archive, displayName: '龙王战士' }] }).listArchives()
  assert.equal(game.displayName, '龙王战士')
})

test('local catalog English names are usable when the primary name is empty', async () => {
  const [game] = await library({ archives: [archive], catalogs: [{ catalog: { games: [{ sha256: 'abc', name: ' ', name_en: 'The King of Dragons' }] } }] }).listArchives()
  assert.equal(game.displayName, 'The King of Dragons')
})
