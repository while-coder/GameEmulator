const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function load(path, globals = {}, imports = {}) {
  const source = readFileSync(resolve(__dirname, '..', path), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  runInNewContext(outputText, { exports, performance: { now: () => 0 }, require(name) {
    assert.ok(name in imports, `Unexpected import: ${name}`)
    return imports[name]
  }, ...globals })
  return exports
}

function rect(left, top, width = 80, height = 40) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}
const candidate = bounds => ({ getBoundingClientRect: () => bounds })
const navigation = load('packages/player-ui/remoteNavigation.ts')

test('dropdown navigation keeps popup focus and returns to adjacent controls after closing', () => {
  const document = { activeElement: null }
  const listeners = [], watchers = [], frames = [], ticks = []
  class Element {
    constructor(left, top) { this.bounds = rect(left, top); this.offsetParent = {} }
    getBoundingClientRect() { return this.bounds }
    focus() { document.activeElement = this }
    scrollIntoView() {}
    closest() { return null }
    click() { this.onClick?.() }
  }
  const back = new Element(0, 0), trigger = new Element(100, 0), next = new Element(200, 0)
  const firstOption = new Element(100, 50), secondOption = new Element(100, 100)
  const container = elements => ({ contains: el => elements.includes(el), querySelectorAll: () => elements })
  const library = container([back, trigger, next]), popup = container([firstOption, secondOption])
  const globals = {
    document, HTMLElement: Element, HTMLInputElement: class extends Element {}, HTMLTextAreaElement: class extends Element {},
    window: { addEventListener(name, handler) { if (name === 'keydown') listeners.push(handler) } },
    requestAnimationFrame(fn) { if (fn.name !== 'pollPads') frames.push(fn); return 1 },
  }
  const ref = value => ({ value })
  const computed = fn => ({ get value() { return fn() } })
  const api = load('packages/player-ui/useRemoteNav.ts', globals, {
    vue: { ref, computed, watch(source, fn, options) { watchers.push({ source, fn }); if (options.immediate) fn(source.value); return () => {} }, onBeforeUnmount() {} },
    './gamepad': { GAMEPAD_AXIS_THRESHOLD: 0.5 }, './remoteNavigation': load('packages/player-ui/remoteNavigation.ts', globals),
  })
  const open = ref(true)
  const close = () => { open.value = false; ticks.push(() => trigger.focus()) }
  secondOption.onClick = close
  api.useRemoteNav({ container: ref(library), active: api.navEnabled, autoFocus: true, priority: 1 })
  api.useRemoteNav({ container: ref(popup), active: computed(() => api.navEnabled.value && open.value), onBack: close, priority: 20 })
  const press = key => {
    let stopped = false
    const event = { key, preventDefault() {}, stopImmediatePropagation() { stopped = true } }
    for (const handler of listeners) { handler(event); if (stopped) break }
  }
  const flushFrames = () => { for (const fn of frames.splice(0)) fn() }
  firstOption.focus()
  press('ArrowDown')
  for (const watcher of watchers) watcher.fn(watcher.source.value)
  flushFrames()
  assert.equal(document.activeElement, secondOption)

  for (const closeKey of ['Escape', 'Enter']) {
    open.value = true
    secondOption.focus()
    press(closeKey)
    for (const tick of ticks.splice(0)) tick()
    assert.equal(document.activeElement, trigger)
    // A delayed activation callback must not reset the restored/next focus.
    watchers[0].fn(true)
    press('ArrowRight')
    flushFrames()
    assert.equal(document.activeElement, next)
    press('ArrowLeft')
    assert.equal(document.activeElement, trigger)
  }
})

test('NES and arcade share one navigation stack and clean up its listeners', () => {
  const listeners = new Set()
  const cleanups = []
  let installed = 0
  const globals = {
    HTMLElement: class {},
    document: { activeElement: null },
    window: {
      addEventListener(name, handler) { if (name === 'keydown') { listeners.add(handler); installed++ } },
      removeEventListener(name, handler) { if (name === 'keydown') listeners.delete(handler) },
    },
    requestAnimationFrame() { return 1 }, cancelAnimationFrame() {},
  }
  const shared = load('packages/player-ui/useRemoteNav.ts', globals, {
    vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch: () => () => {}, onBeforeUnmount: fn => cleanups.push(fn) },
    './gamepad': { GAMEPAD_AXIS_THRESHOLD: 0.5 }, './remoteNavigation': load('packages/player-ui/remoteNavigation.ts', globals),
  })
  const nes = load('packages/nes/src/composables/useRemoteNav.ts', {}, { '../../../player-ui/useRemoteNav': shared })
  const arcade = load('packages/arcade/src/composables/useRemoteNav.ts', {}, { '../../../player-ui/useRemoteNav': shared })
  assert.equal(nes.navEnabled, arcade.navEnabled)
  assert.equal(nes.hasGamepad, arcade.hasGamepad)
  const before = installed
  let nesBack = 0, arcadeBack = 0
  const options = { container: { value: null }, active: { value: true } }
  nes.useRemoteNav({ ...options, priority: 1, onBack: () => nesBack++ })
  arcade.useRemoteNav({ ...options, priority: 10, onBack: () => arcadeBack++ })
  assert.equal(installed - before, 1)
  const pressBack = () => { for (const handler of listeners) handler({ key: 'GoBack', preventDefault() {}, stopImmediatePropagation() {} }) }
  pressBack()
  assert.equal(arcadeBack, 1)
  assert.equal(nesBack, 0)
  cleanups[1]()
  pressBack()
  assert.equal(nesBack, 1)
  cleanups[0]()
  assert.equal(listeners.size, before)
})

test('horizontal movement chooses a same-row neighbor over a closer diagonal', () => {
  const from = rect(100, 100)
  for (const [dir, x] of [['right', 300], ['left', -100]]) {
    const neighbor = candidate(rect(x, 100))
    const diagonal = candidate(rect(dir === 'right' ? 110 : 90, 145))
    assert.equal(navigation.pickNeighbor(from, [diagonal, neighbor], dir), neighbor)
    assert.equal(navigation.pickNeighbor(from, [diagonal], dir), null)
  }
})

test('row edges stay put and vertical navigation still works', () => {
  const from = rect(100, 100)
  const sameRow = candidate(rect(200, 105, 120, 30))
  const below = candidate(rect(100, 160))
  assert.equal(navigation.pickNeighbor(from, [sameRow, below], 'right'), sameRow)
  assert.equal(navigation.pickNeighbor(from, [sameRow, below], 'left'), null)
  assert.equal(navigation.pickNeighbor(from, [sameRow, below], 'down'), below)
  assert.equal(navigation.pickNeighbor(below.getBoundingClientRect(), [candidate(from)], 'up')?.getBoundingClientRect(), from)
})

test('repeat guard limits held keys but keeps quick taps and direction changes responsive', () => {
  const allow = navigation.createNavigationRepeatGuard()
  assert.equal(allow({ key: 'ArrowRight', repeat: false }, 0), true)
  assert.equal(allow({ key: 'ArrowRight', repeat: true }, 30), false)
  assert.equal(allow({ key: 'ArrowRight', repeat: true }, 120), true)
  assert.equal(allow({ key: 'ArrowLeft', repeat: true }, 130), true)
  assert.equal(allow({ key: 'ArrowLeft', repeat: false }, 140), true)
})

for (const kind of ['nes', 'arcade']) {
  test(`${kind}: remote moves once along the row, stays at the edge, and preserves text editing and sliders`, () => {
    const document = { activeElement: null }
    const listeners = {}
    class Element {
      constructor(bounds) { this.bounds = bounds; this.offsetParent = {}; this.disabled = false }
      getBoundingClientRect() { return this.bounds }
      focus(options) { assert.equal(options.preventScroll, true); document.activeElement = this }
      blur() { document.activeElement = null }
      closest(selector) {
        return ({ '[data-nav-row]': this.navigationRow, '[data-nav-grid]': this.navigationGrid, '[data-nav-cell]': this.navigationCell })[selector] ?? null
      }
      hasAttribute(name) { return name === 'data-nav-primary' && this.primary === true }
      click() {}
      scrollIntoView(options) { assert.equal(options.block, 'nearest'); assert.equal(options.behavior, 'instant') }
    }
    class Input extends Element {
      dispatchEvent() {}
    }
    const first = new Element(rect(100, 100))
    const second = new Element(rect(200, 100))
    const diagonal = new Element(rect(110, 145))
    const disabled = new Element(rect(190, 100)); disabled.disabled = true
    const elements = [first, second, diagonal, disabled]
    const rows = []
    const container = { querySelectorAll: () => elements, contains: el => elements.includes(el) || rows.includes(el) }
    const globals = {
      window: { addEventListener: (key, fn) => { listeners[key] = fn } }, document,
      HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: class extends Element {},
      requestAnimationFrame() { return 1 }, performance: { now: () => 0 }, Event: class {},
    }
    const textNavigation = load('packages/player-ui/remoteNavigation.ts', globals)
    const shared = load('packages/player-ui/useRemoteNav.ts', globals, {
      vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch: () => () => {}, onBeforeUnmount() {} },
      './gamepad': { GAMEPAD_AXIS_THRESHOLD: 0.5 }, './remoteNavigation': textNavigation,
    })
    const api = load(`packages/${kind}/src/composables/useRemoteNav.ts`, globals, {
      '../../../player-ui/useRemoteNav': shared,
    })
    assert.equal(api.useRemoteNav, shared.useRemoteNav)
    assert.equal(api.navEnabled, shared.navEnabled)
    api.useRemoteNav({ container: { value: container }, active: { value: true } })
    const press = (key, modifiers = {}) => {
      let prevented = false
      listeners.keydown({ key, ...modifiers, preventDefault() { prevented = true } })
      return prevented
    }
    document.activeElement = first
    assert.equal(press('ArrowRight'), true)
    assert.equal(document.activeElement, second)
    press('ArrowRight')
    assert.equal(document.activeElement, second)
    press('ArrowLeft')
    assert.equal(document.activeElement, first)
    const input = new Input(rect(100, 200)); input.type = 'search'; input.value = 'search'; input.selectionStart = input.selectionEnd = 2; elements.push(input)
    document.activeElement = input
    assert.equal(press('ArrowRight'), false)
    assert.equal(document.activeElement, input)
    api.navMode.value = true
    let consumed = false
    listeners['tv-text-input-dismissed']({ preventDefault() { consumed = true } })
    assert.equal(consumed, true)
    assert.equal(document.activeElement, input)
    const besideInput = new Element(rect(200, 200)); elements.push(besideInput)
    assert.equal(press('ArrowRight'), true)
    assert.equal(document.activeElement, besideInput)
    // Simulate a fresh input focus, then a returned BACK without an IME event.
    listeners.focusout({ target: input })
    document.activeElement = input
    assert.equal(press('ArrowRight'), false)
    assert.equal(press('GoBack'), true)
    assert.equal(textNavigation.isTextNavigationIdle(input), true)
    press('Enter')
    assert.equal(textNavigation.isTextNavigationIdle(input), false)
    assert.equal(press('ArrowRight'), false)
    input.type = 'range'; input.step = '1'; input.min = '0'; input.max = '10'; input.value = '5'
    assert.equal(press('ArrowRight'), true)
    assert.equal(input.value, '6')
    assert.equal(document.activeElement, input)

    const beforeInput = new Element(rect(0, 200)); elements.push(beforeInput)
    input.type = 'search'; input.value = ''; input.selectionStart = input.selectionEnd = 0
    press('ArrowRight')
    assert.equal(document.activeElement, besideInput)
    press('ArrowLeft')
    assert.equal(document.activeElement, input)
    press('ArrowLeft')
    assert.equal(document.activeElement, beforeInput)
    input.value = 'search'
    document.activeElement = input
    input.selectionStart = input.selectionEnd = 3
    assert.equal(press('ArrowRight'), false)
    assert.equal(press('ArrowLeft'), false)
    assert.equal(document.activeElement, input)
    input.selectionStart = input.selectionEnd = 0
    press('ArrowLeft')
    assert.equal(document.activeElement, beforeInput)
    document.activeElement = input
    input.selectionStart = input.selectionEnd = input.value.length
    assert.equal(press('ArrowRight', { shiftKey: true }), false)
    assert.equal(press('ArrowRight', { isComposing: true }), false)
    press('ArrowRight')
    assert.equal(document.activeElement, besideInput)
    document.activeElement = input
    input.selectionStart = 0; input.selectionEnd = input.value.length
    assert.equal(press('ArrowLeft'), false)
    assert.equal(press('ArrowRight'), false)
    assert.equal(document.activeElement, input)

    // Scrolled game cards can overlap the header's coordinates while clipped.
    // Header left/right must stay between Back and Settings.
    const back = new Element(rect(20, 20, 68, 34))
    const settings = new Element(rect(710, 20, 72, 34))
    const clippedCard = new Element(rect(110, -100, 240, 160))
    const header = { contains: el => el === back || el === settings }
    rows.push(header)
    back.navigationRow = settings.navigationRow = header
    elements.splice(0, elements.length, back, settings, clippedCard)
    document.activeElement = back
    press('ArrowRight')
    assert.equal(document.activeElement, settings)
    press('ArrowRight')
    assert.equal(document.activeElement, settings)
    press('ArrowLeft')
    assert.equal(document.activeElement, back)
    press('ArrowLeft')
    assert.equal(document.activeElement, back)
    const belowHeader = new Element(rect(20, 100)); elements.push(belowHeader)
    press('ArrowDown')
    assert.equal(document.activeElement, belowHeader)

    // Fixed controls can be closer than the next offscreen game row.
    const previousGame = new Element(rect(200, -120, 200, 200))
    const currentGame = new Element(rect(200, 100, 200, 200))
    const nextGame = new Element(rect(200, 320, 200, 200))
    const removeGame = new Element(rect(360, 105, 30, 30))
    const filter = new Element(rect(200, 40, 200, 30))
    const pager = new Element(rect(200, 315, 200, 30))
    const games = [previousGame, currentGame, nextGame]
    const grid = { contains: el => games.includes(el) || el === removeGame }
    rows.push(grid)
    for (const game of games) {
      game.navigationGrid = grid; game.navigationCell = game; game.primary = true
    }
    removeGame.navigationGrid = grid; removeGame.navigationCell = currentGame
    elements.splice(0, elements.length, ...games, removeGame, filter, pager)
    document.activeElement = currentGame
    press('ArrowUp')
    assert.equal(document.activeElement, previousGame)
    press('ArrowDown')
    assert.equal(document.activeElement, currentGame)
    press('ArrowDown')
    assert.equal(document.activeElement, nextGame)
    document.activeElement = removeGame
    press('ArrowUp')
    assert.equal(document.activeElement, previousGame)

    // Model the new coordinates after scrolling the first/last row into view.
    previousGame.bounds = rect(200, 100, 200, 200)
    currentGame.bounds = rect(200, 320, 200, 200)
    nextGame.bounds = rect(200, 540, 200, 200)
    document.activeElement = previousGame
    press('ArrowUp')
    assert.equal(document.activeElement, filter)
    previousGame.bounds = rect(200, -340, 200, 200)
    currentGame.bounds = rect(200, -120, 200, 200)
    nextGame.bounds = rect(200, 100, 200, 200)
    document.activeElement = nextGame
    press('ArrowDown')
    assert.equal(document.activeElement, pager)
  })
}
