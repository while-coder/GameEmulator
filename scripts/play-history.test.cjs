const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
function setup(globals = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../packages/shared/playHistory.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, ...globals })
  const entries = new Map()
  const storage = { get length() { return entries.size }, key: index => [...entries.keys()][index] ?? null, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  return { ...exports, storage, entries }
}
for (const system of ['nes', 'arcade']) {
  test(`${system}: count only running segments, excluding pauses and checkpoints without double-counting`, () => {
    const api = setup(), history = {}
    let now = 0
    const session = api.createPlaySession((key, at, elapsed) => { history[key] = api.recordPlay(api.storage, system, key, at, elapsed, history[key]) }, () => now, () => 1000 + now)
    session.start('game')
    now = 5000 // loading / paused: no running segment
    session.setRunning(true)
    now = 15000; session.flush()
    now = 20000; session.setRunning(false)
    now = 80000; session.flush() // paused or backgrounded
    assert.equal(history.game.totalPlayTimeMs, 15000)
    session.setRunning(true)
    now = 85000; session.stop(); session.stop()
    assert.equal(history.game.totalPlayTimeMs, 20000)
    assert.equal(api.loadPlayHistory(api.storage, system).game.totalPlayTimeMs, 20000)
  })

  test(`${system}: switching games flushes the first game, replay accumulates time, and reload retains recency`, () => {
    const api = setup()
    let now = 0
    const session = api.createPlaySession((key, at, elapsed) => api.recordPlay(api.storage, system, key, at, elapsed), () => now, () => now + 1000)
    session.start('a'); session.setRunning(true)
    now = 60000; session.start('b'); session.setRunning(true)
    now = 70000; session.stop()
    now = 80000; session.start('a'); session.setRunning(true)
    now = 100000; session.stop()
    const history = api.loadPlayHistory(api.storage, system)
    assert.equal(history.a.totalPlayTimeMs, 80000)
    assert.equal(history.b.totalPlayTimeMs, 10000)
    assert.ok(history.a.lastPlayedAt > history.b.lastPlayedAt)
    const games = [{key:'unplayed'},{key:'b'},{key:'a'}]
    const sorted = api.sortRecentlyPlayed(games, game => game.key, history)
    assert.deepEqual(Array.from(sorted, game => game.key), ['a', 'b', 'unplayed'])
    assert.equal(games[0].key, 'unplayed')
  })
}

test('history is isolated by emulator and ignores unrelated or corrupt local storage entries', () => {
  const api = setup()
  api.recordPlay(api.storage, 'nes', 'same-hash', 100, 3000)
  api.recordPlay(api.storage, 'arcade', 'same-hash', 200, 5000)
  api.entries.set('other-setting', '{}')
  api.entries.set('game-emulator:play-history:nes:broken', '{')
  api.entries.set('game-emulator:play-history:nes:invalid', '{"lastPlayedAt":10,"totalPlayTimeMs":-1}')
  assert.equal(Object.keys(api.loadPlayHistory(api.storage, 'nes')).length, 1)
  assert.equal(api.loadPlayHistory(api.storage, 'nes')['same-hash'].totalPlayTimeMs, 3000)
  assert.equal(api.loadPlayHistory(api.storage, 'arcade')['same-hash'].totalPlayTimeMs, 5000)
})

test('storage errors retain session tracking in memory and the formatter handles seconds, minutes and hours', () => {
  const api = setup()
  const denied = { getItem() { throw Error('denied') }, setItem() { throw Error('full') } }
  const first = api.recordPlay(denied, 'nes', 'game', 100, 2000)
  const second = api.recordPlay(denied, 'nes', 'game', 101, 3000, first)
  assert.equal(second.totalPlayTimeMs, 5000)
  assert.equal(api.formatPlayTime(2000), '2 秒')
  assert.equal(api.formatPlayTime(120000), '2 分钟')
  assert.equal(api.formatPlayTime(3900000), '1 小时 5 分')
})

test('legacy last-played metadata sorts existing NES games, without treating unplayed downloads as played', () => {
  const api = setup()
  const games = [{key:'downloaded'},{key:'old',last:100},{key:'new',last:200}]
  const sorted = api.sortRecentlyPlayed(games, g => g.key, {}, g => g.last ?? 0)
  assert.deepEqual(Array.from(sorted, g => g.key), ['new','old','downloaded'])
})

for (const system of ['nes', 'arcade']) {
  test(`${system}: the shared lifecycle hook flushes on background/pagehide, excludes paused time, and removes listeners`, () => {
    const vue = require('vue')
    let now = 0
    const api = setup({ performance:{now:()=>now}, Date:class extends Date { static now(){return now+1000} } })
    const mounted=[],cleanups=[],windowEvents=new Map(),docEvents=new Map()
    let timer, cleared = false
    const document = { hidden:false, addEventListener:(key,fn)=>docEvents.set(key,fn),removeEventListener:key=>docEvents.delete(key) }
    const window = {localStorage:api.storage,addEventListener:(key,fn)=>windowEvents.set(key,fn),removeEventListener:key=>windowEvents.delete(key)}
    const exports = {}
    const code = ts.transpileModule(readFileSync(resolve(__dirname, '../packages/player-ui/usePlayHistory.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    const stops=[]
    runInNewContext(code,{exports,document,window,setInterval:fn=>{timer=fn;return 1},clearInterval:()=>{cleared=true},require:name=>name==='vue'?{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>cleanups.push(fn),watch:(...args)=>{const stop=vue.watch(...args);stops.push(stop);return stop}}:api})
    const game=vue.ref(null),playing=vue.ref(false)
    exports.usePlaySession(system,game,playing)
    mounted.forEach(fn=>fn())
    game.value='successful-game';playing.value=true
    now=10000;timer()
    document.hidden=true;docEvents.get('visibilitychange')()
    now=90000;timer()
    assert.equal(api.loadPlayHistory(api.storage,system)['successful-game'].totalPlayTimeMs,10000)
    document.hidden=false;docEvents.get('visibilitychange')()
    now=95000;playing.value=false
    now=120000;playing.value=true
    now=125000;windowEvents.get('pagehide')()
    assert.equal(api.loadPlayHistory(api.storage,system)['successful-game'].totalPlayTimeMs,20000)
    now=150000;timer()
    assert.equal(api.loadPlayHistory(api.storage,system)['successful-game'].totalPlayTimeMs,20000)
    cleanups.forEach(fn=>fn());stops.forEach(fn=>fn())
    assert.equal(windowEvents.size,0)
    assert.equal(docEvents.size,0)
    assert.equal(cleared,true)
  })
}
