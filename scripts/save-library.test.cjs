const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

function compile(file, globals = {}, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(code, { exports, require: key => { assert.ok(key in imports, key); return imports[key] }, Blob, ...globals })
  return exports
}
function database() {
  const records = new Map()
  const db = { transaction() {
    let pending = 0, completed = false
    const tx = {}
    const settle = () => setImmediate(() => { if (!pending && !completed) { completed = true; tx.oncomplete?.() } })
    const request = action => {
      pending++
      const req = {}
      queueMicrotask(() => { req.result = action(); req.onsuccess?.(); pending--; settle() })
      return req
    }
    tx.objectStore = () => ({
      getAll: () => request(() => structuredClone([...records.values()])),
      get: key => request(() => structuredClone(records.get(key))),
      put: record => request(() => { records.set(record.key, structuredClone(record)); return record.key }),
      delete: key => request(() => records.delete(key)),
    })
    settle()
    return tx
  } }
  return { records, indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess() }); return req } } }
}
function setup(kind) {
  const db = database(), shared = compile('packages/shared/saveSlots.ts')
  const api = compile(`packages/${kind}/src/store/${kind === 'nes' ? 'saveState' : 'library'}.ts`, { indexedDB: db.indexedDB }, { '../../../shared/saveSlots': shared })
  const state = byte => kind === 'nes' ? new Uint8Array([byte]) : new Blob([new Uint8Array([byte])])
  const base = (core = 'native-v1', game = 'game', byte = 1) => ({ key: `${core}:${game}:bios`, gameName: game, gameHash: game, coreBuild: core, dependencies: [{name:'bios.zip',hash:'bios'}], state: state(byte), savedAt: Date.now() })
  return {
    ...db, api, shared,
    async quick(byte, core = 'native-v1', game = 'game') {
      if (kind === 'nes') await api.putSaveState(game, `quick:${core}`, game, state(byte), undefined, 'quick', core)
      else await api.putSnapshot({...base(core, game, byte), kind:'quick'})
    },
    async normal(label, core = 'native-v1', game = 'game') {
      return kind === 'nes' ? api.createSaveState(game, game, label, state(2), core) : api.createSnapshot(base(core, game, 2), label)
    },
    list: () => kind === 'nes' ? api.listAllSaveStates() : api.listSnapshots(),
    rename: (key, label) => kind === 'nes' ? api.renameSaveState(key, label) : api.renameSnapshot(key, label),
    remove: key => kind === 'nes' ? api.deleteSaveStateByKey(key) : api.removeSnapshot(key),
  }
}

for (const kind of ['nes', 'arcade']) {
  test(`${kind}: multiple ordinary saves survive repeated quick saves and rename/delete affect only the selected ordinary save`, async () => {
    const lib = setup(kind)
    await lib.quick(1)
    const first = await lib.normal('存档 1'), second = await lib.normal('存档 2')
    assert.notEqual(first.key, second.key)
    await lib.quick(9)
    let records = await lib.list()
    assert.equal(records.length, 3)
    assert.equal(records.filter(r => lib.shared.saveKindOf(r) === 'quick').length, 1)
    const quick = records.find(r => lib.shared.saveKindOf(r) === 'quick')
    const bytes = kind === 'nes' ? quick.state : new Uint8Array(await quick.state.arrayBuffer())
    assert.equal(bytes[0], 9)
    await lib.rename(first.key, 'Boss 前')
    assert.equal((await lib.list()).find(r => r.key === first.key).label, 'Boss 前')
    await lib.remove(first.key)
    records = await lib.list()
    assert.equal(records.length, 2)
    assert.ok(records.some(r => r.key === second.key))
    await lib.remove(quick.key)
    records = await lib.list()
    assert.equal(records.length, 1)
    assert.equal(records[0].key, second.key)
  })

  test(`${kind}: quick save updates and deletion preserve other games, core versions and ordinary slots`, async () => {
    const lib = setup(kind)
    await lib.quick(1)
    await lib.quick(3, 'wasm-v1')
    await lib.quick(4, 'native-v1', 'another-game')
    const normal = await lib.normal('普通存档')
    await lib.quick(8)
    const records = await lib.list()
    assert.equal(records.length, 4)
    const quick = records.find(r => lib.shared.saveKindOf(r) === 'quick' && r.coreBuild === 'native-v1' && (r.gameHash ?? r.romKey) === 'game')
    await lib.remove(quick.key)
    const remaining = await lib.list()
    assert.equal(remaining.length, 3)
    assert.ok(remaining.some(r => r.key === normal.key))
    assert.ok(remaining.some(r => r.coreBuild === 'wasm-v1'))
  })
}

test('arcade: legacy snapshots remain quick saves, ordinary saves retain the exact dependency bundle identity', async () => {
  const lib = setup('arcade')
  const legacy = { key:'core:game:old-dependency',gameName:'game',gameHash:'game',coreBuild:'core',dependencies:[],state:new Blob(['old']),savedAt:1 }
  lib.records.set(legacy.key, legacy)
  assert.equal(lib.shared.saveKindOf((await lib.list())[0]), 'quick')
  const normal = await lib.api.createSnapshot(legacy, '存档 1')
  assert.notEqual(normal.key, legacy.key)
  assert.equal(lib.api.snapshotBundleKey(normal), legacy.key)
  assert.equal(lib.api.snapshotBundleKey(legacy), legacy.key)
  await lib.api.putSnapshot({...legacy,key:'core:game:new-dependency',savedAt:2})
  assert.equal((await lib.list()).length, 2)
  assert.equal(lib.api.snapshotBundleKey((await lib.list()).find(r => r.key === normal.key)), legacy.key)
})

test('shared save kinds recognize legacy native quick slots and generated labels avoid duplicates after deletion or rename', () => {
  const shared = compile('packages/shared/saveSlots.ts')
  assert.equal(shared.saveKindOf({slot:'quick:native-v1'}), 'quick')
  assert.equal(shared.saveKindOf({slot:'s-1-0'}), 'normal')
  assert.equal(shared.nextSaveLabel([{kind:'quick'}, {kind:'normal',label:'存档 3'}, {kind:'normal',label:'Boss'}]), '存档 4')
  assert.notEqual(shared.newSaveSlot(), shared.newSaveSlot())
})

function shellFunction(kind, name, context) {
  const file = kind === 'nes' ? 'packages/nes/src/components/PlayerShell.vue' : 'packages/arcade/src/ArcadeView.vue'
  const script = readFileSync(resolve(__dirname, '..', file), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const source = ts.createSourceFile('shell.ts', script, ts.ScriptTarget.Latest, true)
  const code = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name).getText(source)
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context[name]
}

test('arcade: F9 reads the quick slot even when an ordinary save is newer', async () => {
  const shared = compile('packages/shared/saveSlots.ts')
  const quick = { key:'quick',gameHash:'game',coreBuild:'core',kind:'quick' }
  let restored
  const restore = shellFunction('arcade', 'quickRestore', {
    current:{value:{hash:'game'}},coreBuild:()=> 'core',saveKindOf:shared.saveKindOf,
    listSnapshots:async()=>[{...quick,key:'normal',kind:'normal'},quick],
    restore:async record=>{restored=record},
  })
  await restore()
  assert.equal(restored.key, 'quick')
})

test('arcade: ordinary saves restore with their bundle identity and reject incompatible dependencies before loading', async () => {
  let loads = 0
  const lib = setup('arcade')
  const context = {
    currentBundle:()=> 'bundle',snapshotBundleKey:lib.api.snapshotBundleKey,
    progress:{value:null},refresh:async()=>{},current:{value:null},currentDependencies:{value:[]},
    input:{releaseAll(){}},runner:{value:{load:async()=>{loads++}}},nextTick:async()=>{},measure(){},
  }
  const load = shellFunction('arcade', 'loadPreparedGame', context)
  await load({hash:'game'},[],{key:'bundle:s-1',bundleKey:'bundle',kind:'normal'})
  assert.equal(loads, 1)
  await assert.rejects(load({hash:'game'},[],{key:'other:s-2',bundleKey:'other',kind:'normal'}), /依赖版本/)
  assert.equal(loads, 1)
})

test('NES: incompatible core saves are kept and rejected before changing the current ROM', async () => {
  let loads = 0, restores = 0
  const context = {
    leaveError:{value:''},settingsOpen:{value:false},settingsTab:{value:'audio'},syncPlayback(){},
    screen:{value:{getSaveNamespace:()=> 'native-v1',applyState:async()=>{restores++;return true}}},
    loadRomBytes:async()=>{loads++},
  }
  const load = shellFunction('nes', 'onLoadSave', context)
  await load({romKey:'game',name:'游戏',state:new Uint8Array([1]),bytes:new Uint8Array([2])})
  assert.equal(loads, 0)
  assert.equal(restores, 0)
  assert.match(context.leaveError.value, /核心版本/)
  assert.equal(context.settingsOpen.value, true)
  await load({romKey:'game',name:'游戏',coreBuild:'native-v1',state:new Uint8Array([1]),bytes:new Uint8Array([2])})
  assert.equal(loads, 1)
  assert.equal(restores, 1)
})
