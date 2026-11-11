const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');

const script = readFileSync(resolve(__dirname, '../android/app/src/main/assets/bridge/bridge.js'), 'utf8');
function setup(pathname, callback, origin = 'http://127.0.0.1:17864', dispatchEvent) {
  let receive;
  const sent = [];
  const navigated = [];
  runInNewContext(script, {
    location: { origin, pathname, replace: url => navigated.push(url) },
    window: { wrappedJSObject: { __handleAndroidBack: callback, dispatchEvent } },
    browser: { runtime: { connectNative: () => ({
      onMessage: { addListener: listener => { receive = listener; } },
      postMessage: message => sent.push(message),
    }) } },
    console: { error() {} }, Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  });
  return { receive, sent, navigated };
}
test('back uses the existing page handler and preserves handled/exit results', () => {
  for (const result of ['handled', 'exit']) {
    let calls = 0;
    const bridge = setup('/nes.html', () => { calls++; return result; });
    bridge.receive({ type: 'back', id: 7 });
    assert.equal(calls, 1);
    assert.equal(bridge.sent[0].result, result);
    assert.equal(bridge.sent[0].id, 7);
    assert.equal(bridge.navigated.length, 0);
  }
});
test('IME dismissal restores navigation without closing the page', () => {
  const events = [];
  let backCalls = 0;
  const bridge = setup('/nes.html', () => { backCalls++; return 'handled'; }, undefined, event => {
    events.push(event);
    return false;
  });
  bridge.receive({ type: 'imeHidden' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tv-text-input-dismissed');
  assert.equal(bridge.sent.length, 0);
  bridge.receive({ type: 'back', id: 8 });
  assert.equal(backCalls, 0);
  assert.equal(bridge.sent[0].result, 'handled');
  assert.equal(bridge.navigated.length, 0);
});
test('BACK resumes page navigation once text editing is already finished', () => {
  let backCalls = 0;
  const bridge = setup('/nes.html', () => { backCalls++; return 'handled'; }, undefined, () => true);
  bridge.receive({ type: 'back', id: 9 });
  assert.equal(backCalls, 1);
  assert.equal(bridge.sent[0].id, 9);
});
test('missing handler exits the launcher or navigates an emulator home', () => {
  const home = setup('/index.html');
  home.receive({ type: 'back', id: 1 });
  assert.equal(home.sent[0].result, 'exit');
  const emulator = setup('/arcade.html');
  emulator.receive({ type: 'back', id: 2 });
  assert.deepEqual(emulator.navigated, ['/index.html']);
  assert.equal(emulator.sent[0].result, 'handled');
});
test('bridge only connects on the bundled origin and ignores unrelated messages', () => {
  assert.equal(setup('/', undefined, 'http://127.0.0.1:9000').receive, undefined);
  const bridge = setup('/');
  bridge.receive({ type: 'unrelated', id: 3 });
  assert.equal(bridge.sent.length, 0);
});
test('a failing page callback does not accidentally close the Activity', () => {
  const bridge = setup('/nes.html', () => { throw Error('failed'); });
  bridge.receive({ type: 'back', id: 4 });
  assert.equal(bridge.sent[0].result, 'handled');
});
