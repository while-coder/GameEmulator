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
    const container = { querySelectorAll: () => elements, contains: el => elements.includes(el) }
    const globals = {
      window: { addEventListener: (key, fn) => { listeners[key] = fn } }, document,
      HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: class extends Element {},
      requestAnimationFrame() { return 1 }, performance: { now: () => 0 }, Event: class {},
    }
    const textNavigation = load('packages/player-ui/remoteNavigation.ts', globals)
    const api = load(`packages/${kind}/src/composables/useRemoteNav.ts`, globals, {
      vue: { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), watch: () => () => {}, onBeforeUnmount() {} },
      '../emulator/settings': {}, '../../../player-ui/remoteNavigation': textNavigation,
    })
    api.useRemoteNav({ container: { value: container }, active: { value: true } })
    const press = key => {
      let prevented = false
      listeners.keydown({ key, preventDefault() { prevented = true } })
      return prevented
    }
    document.activeElement = first
    assert.equal(press('ArrowRight'), true)
    assert.equal(document.activeElement, second)
    press('ArrowRight')
    assert.equal(document.activeElement, second)
    press('ArrowLeft')
    assert.equal(document.activeElement, first)
    const input = new Input(rect(100, 200)); input.type = 'search'; elements.push(input)
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
  })
}
