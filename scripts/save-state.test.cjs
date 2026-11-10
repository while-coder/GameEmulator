const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

// Run the real runner classes with a core that reproduces RetroArch's automatic
// unpause on load. Nostalgist's separate status flag does not see that change.
function setup(kind) {
  let paused = false
  let status = 'running'
  let finishLoad
  const module = {
    _cmd_pause() { paused = true },
    _cmd_unpause() { paused = false },
  }
  const instance = {
    getEmscripten: () => ({ Module: module }),
    pause() { if (status === 'running') paused = !paused; status = 'paused' },
    resume() { if (status === 'paused') paused = !paused; status = 'running' },
    loadState() {
      return new Promise(resolve => {
        finishLoad = () => { paused = false; resolve() }
      })
    },
  }
  const source = readFileSync(resolve(__dirname, `../packages/${kind}/src/emulator/runner.ts`), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  const requireMock = name => {
    if (name === './settings') return { ACTIONS: [] }
    if (name === 'nostalgist' || name.endsWith('?url')) return {}
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'exports', outputText)(requireMock, exports)
  const canvas = { style: { cssText: '', removeProperty() {} } }
  const runner = new (kind === 'nes' ? exports.NesRunner : exports.ArcadeRunner)(canvas)
  runner.instance = instance
  if (kind === 'nes') runner.running = true
  const load = () => kind === 'nes'
    ? runner.loadState(new Uint8Array([1]))
    : runner.restore(new Blob([new Uint8Array([1])]))
  return { runner, load, finish: () => finishLoad(), isPaused: () => paused, module }
}

for (const kind of ['nes', 'arcade']) {
  test(`${kind}: resume repairs a paused core even when the runner reports running`, () => {
    const core = setup(kind)
    core.module._cmd_pause()
    core.runner.resume()
    assert.equal(core.isPaused(), false)
    core.runner.resume()
    assert.equal(core.isPaused(), false)
    core.runner.pause()
    core.module._cmd_unpause()
    core.runner.pause()
    assert.equal(core.isPaused(), true)
  })

  test(`${kind}: loading from a paused menu must resume when the menu closes`, async () => {
    const core = setup(kind)
    core.runner.pause()
    const pending = core.load()
    core.finish()
    await pending
    assert.equal(core.isPaused(), true)
    core.runner.resume()
    assert.equal(core.isPaused(), false)
  })

  test(`${kind}: preserve running state across repeated loads`, async () => {
    const core = setup(kind)
    for (let i = 0; i < 3; i++) {
      const pending = core.load()
      core.finish()
      await pending
      assert.equal(core.isPaused(), false)
    }
  })

  test(`${kind}: use the latest pause state when a load finishes`, async () => {
    const core = setup(kind)
    const pending = core.load()
    core.runner.pause()
    core.finish()
    await pending
    assert.equal(core.isPaused(), true)
    core.runner.resume()
    assert.equal(core.isPaused(), false)
  })

  test(`${kind}: closing the menu while loading keeps the core running`, async () => {
    const core = setup(kind)
    core.runner.pause()
    const pending = core.load()
    core.runner.resume()
    core.finish()
    await pending
    assert.equal(core.isPaused(), false)
  })
}
