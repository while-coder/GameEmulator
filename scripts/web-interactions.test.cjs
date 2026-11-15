const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function setup() {
  const listeners = new Map()
  const viewport = {}
  class Element {
    constructor(control = false, editor = false) { this.control = control; this.editor = editor }
    closest(selector) { return (selector === '[data-game-control]' ? this.control : this.editor) ? this : null }
  }
  const document = {
    querySelector: () => viewport,
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }) },
  }
  const exports = {}
  const source = readFileSync(resolve(__dirname, '../packages/player-ui/interaction.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  runInNewContext(outputText, { exports, document, Element, require: () => ({}) })
  exports.configureWebInteractions()
  function dispatch(type, target, extra = {}) {
    const event = { target, cancelable: true, prevented: false, preventDefault() { this.prevented = true }, ...extra }
    listeners.get(type).handler(event)
    return event.prevented
  }
  return { listeners, viewport, Element, dispatch, configure: exports.configureWebInteractions }
}

test('native game touches are canceled without suppressing menu clicks, editors or list scrolling', () => {
  const { Element, dispatch, listeners } = setup()
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(dispatch(type, new Element(true)), true)
    assert.equal(dispatch(type, new Element()), false)
    assert.equal(dispatch(type, new Element(false, true)), false)
    assert.equal(dispatch(type, new Element(true), { cancelable: false }), false)
    assert.equal(listeners.get(type).options.passive, false)
    assert.equal(listeners.get(type).options.capture, true)
  }
  assert.equal(listeners.has('click'), false)
  assert.equal(listeners.has('pointerdown'), false)
  assert.equal(listeners.has('pointerup'), false)
})

test('browser menus, dragging and zoom gestures are suppressed while text editing and normal wheel scrolling work', () => {
  const { Element, dispatch } = setup()
  assert.equal(dispatch('contextmenu', new Element()), true)
  for (const type of ['selectstart', 'dragstart']) {
    assert.equal(dispatch(type, new Element()), true)
    assert.equal(dispatch(type, new Element(false, true)), false)
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    assert.equal(dispatch(type, new Element()), true)
  }
  assert.equal(dispatch('wheel', new Element(), { ctrlKey: true }), true)
  assert.equal(dispatch('wheel', new Element(), { ctrlKey: false }), false)
})

test('shared interaction setup is idempotent and locks the mobile viewport', () => {
  const { configure, listeners, viewport } = setup()
  const touchListener = listeners.get('touchstart')
  configure()
  assert.equal(listeners.get('touchstart'), touchListener)
  assert.match(viewport.content, /user-scalable=no/)
})
