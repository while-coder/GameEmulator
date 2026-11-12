const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

// Exercise the shell's actual event handlers without loading emulator cores.
function shell(kind) {
  const path = kind === 'nes' ? 'nes/src/components/PlayerShell.vue' : 'arcade/src/ArcadeView.vue'
  const script = readFileSync(resolve(__dirname, '../packages', path), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const source = ts.createSourceFile('shell.ts', script, ts.ScriptTarget.Latest, true)
  const handlers = new Set(['openMenu', 'resumeGame', 'showSettings', kind === 'nes' ? 'onShellKey' : 'shellKey'])
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && handlers.has(node.name.text)).map(node => node.getText(source)).join('\n')
  const ref = value => ({ value })
  const context = {
    settingsOpen: ref(false), menuOpen: ref(false), pauseOpen: ref(false),
    romName: ref('Test game'), loaded: ref(true), paused: ref(false),
    settingsTab: ref('audio'), tab: ref('audio'), saveMessage: ref(''),
    busy: ref(false), leaving: ref(false), creatingSave: ref(false), loading: ref(false),
    libraryBusy: ref(false), settingsModal: ref(null), layoutEditing: ref(false),
    navEnabled: ref(false), capturing: ref(null), editingKey: ref(null), Element: class {},
  }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const press = () => {
    const event = { code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }
    context[kind === 'nes' ? 'onShellKey' : 'shellKey'](event)
  }
  return { context, press, settings: kind === 'nes' ? context.settingsOpen : context.menuOpen, tab: kind === 'nes' ? context.settingsTab : context.tab }
}

for (const kind of ['nes', 'arcade']) {
  test(`${kind}: Esc opens pause menu and a second Esc resumes without changing settings tab`, () => {
    const { context, press, settings, tab } = shell(kind)
    press()
    assert.equal(context.pauseOpen.value, true)
    assert.equal(settings.value, false)
    assert.equal(tab.value, 'audio')
    press()
    assert.equal(context.pauseOpen.value, false)
    assert.equal(settings.value, false)
  })

  test(`${kind}: settings and load actions leave pause menu; Esc is blocked during saving`, () => {
    const { context, press, settings, tab } = shell(kind)
    press()
    context[kind === 'nes' ? 'creatingSave' : 'busy'].value = true
    press()
    assert.equal(context.pauseOpen.value, true)
    context[kind === 'nes' ? 'creatingSave' : 'busy'].value = false
    context.showSettings('saves')
    assert.equal(context.pauseOpen.value, false)
    assert.equal(settings.value, true)
    assert.equal(tab.value, 'saves')
  })

  test(`${kind}: Esc in library opens settings directly`, () => {
    const { context, press, settings } = shell(kind)
    context.romName.value = null
    context.loaded.value = false
    press()
    assert.equal(settings.value, true)
    assert.equal(context.pauseOpen.value, false)
  })
}
