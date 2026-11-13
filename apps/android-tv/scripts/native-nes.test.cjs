const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [resolve(__dirname, '..')] }));
const code = ts.transpileModule(readFileSync(resolve(__dirname, '../../../packages/android-native/src/nes.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const BUILD = 'fceumm-e0f3086-native-v1';
function setup(overrides = {}) {
  const calls = [];
  const listeners = new Map();
  const output = { style: {}, remove() {} };
  const canvas = { parentElement: { append() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 240 }) };
  const exports = {};
  const context = {
    exports, require: id => id === './transport' ? { httpNativeTransport: (path, method, body) => context.fetch(path, { method, body, headers: { 'X-GameEmulator-TV': '1' } }) } : ({ Button: {} }), TextEncoder, TextDecoder, Uint8Array, Blob,
    crypto: globalThis.crypto, AbortSignal, structuredClone, innerWidth: 1920, innerHeight: 1080,
    document: { createElement: () => output }, ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), setInterval: () => 1 },
    clearInterval() {},
    fetch: async (url, options) => {
      const path = url.split('/').at(-1);
      calls.push({ path, url, options, command: path === 'command' ? JSON.parse(options.body) : undefined });
      const result = overrides[path]?.(options);
      if (result) return result;
      if (path === 'info') return Response.json({ build: url.includes('/arcade/') ? 'fbalpha2012-0ce3153-native-v1' : BUILD });
      if (path === 'load') return Response.json({ hash: 'rom-hash', build: BUILD });
      if (path === 'state') return new Response(new Uint8Array([1, 2, 3, 4]));
      if (path === 'frame') return new Response(new Uint8Array());
      return Response.json({ ok: true });
    },
  };
  runInNewContext(code, context);
  return { runner: new exports.NativeNesRunner(canvas), calls, listeners, context, exports, canvas };
}
test('native save round trips and rejects legacy, corrupt and other-ROM states before reaching the core', async () => {
  const { runner, calls } = setup();
  await runner.loadRom(new Uint8Array(16));
  const state = await runner.saveState();
  assert.equal(await runner.loadState(state), true);
  const restores = () => calls.filter(call => call.path === 'restore').length;
  assert.equal(restores(), 1);
  await assert.rejects(runner.loadState(new Uint8Array([0, 1, 2])), /WASM/);
  const corrupt = state.slice(); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(runner.loadState(corrupt), /校验失败/);
  const otherRom = new TextEncoder().encode(new TextDecoder().decode(state).replace('rom-hash', 'bad-hash'));
  await assert.rejects(runner.loadState(otherRom), /不匹配/);
  assert.equal(restores(), 1);
  await runner.dispose();
});

test('arcade files upload in bounded chunks and a disposed runner can start another game', async () => {
  const { runner, context, exports, calls, canvas } = setup();
  await runner.dispose();
  const arcadeCode = ts.transpileModule(readFileSync(resolve(__dirname, '../../../packages/android-native/src/arcade.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const arcadeExports = {};
  runInNewContext(arcadeCode, { ...context, exports: arcadeExports, require: () => exports });
  const arcade = new arcadeExports.NativeArcadeRunner(canvas);
  const bytes = new Uint8Array(600000).fill(127);
  const game = { name: 'game.zip', hash: 'a'.repeat(64), file: new Blob([bytes]) };
  const bios = { name: 'neogeo.zip', hash: 'b'.repeat(64), file: new Blob([new Uint8Array([1, 2, 3])]) };
  await arcade.load(game, [bios]);
  assert.equal(arcade.loaded, true);
  const uploads = calls.filter(call => call.url.includes('/upload/'));
  assert.equal(uploads.length, 4);
  assert.deepEqual(uploads.slice(0, 3).map(call => Number(call.path)), [0, 262144, 524288]);
  for (const upload of uploads) assert.ok(upload.options.body.size <= 262144);
  const uploaded = await Promise.all(uploads.slice(0, 3).map(async call => new Uint8Array(await call.options.body.arrayBuffer())));
  assert.equal(Buffer.concat(uploaded).equals(Buffer.from(bytes)), true);
  const state = await arcade.save();
  assert.match(new TextDecoder().decode(await state.arrayBuffer()), /^GameEmulator:fbalpha2012-0ce3153-native-v1/);
  await arcade.dispose();
  assert.equal(arcade.loaded, false);
  await arcade.load(game, [bios]);
  assert.equal(arcade.loaded, true);
  await arcade.restore(state);
  await arcade.load(game, [{ ...bios, hash: 'c'.repeat(64) }]);
  await assert.rejects(arcade.restore(state), /不匹配/);
  await arcade.dispose();
});
test('incompatible native build cannot start a game', async () => {
  const { runner, calls } = setup({ info: () => Response.json({ build: 'different-build' }) });
  await assert.rejects(runner.loadRom(new Uint8Array(16)), /版本不匹配/);
  assert.equal(calls.some(call => call.path === 'load'), false);
  assert.equal(runner.loaded, false);
  await runner.dispose();
});
test('pause, resume and shutdown are serialized; a failed operation does not prevent shutdown', async () => {
  let failState = false;
  const { runner, calls, listeners } = setup({ state: () => failState ? Response.json({ error: 'save failed' }, { status: 400 }) : undefined });
  await runner.loadRom(new Uint8Array(16));
  runner.resume();
  runner.pause(); runner.resume();
  failState = true;
  await assert.rejects(runner.saveState(), /save failed/);
  await runner.dispose();
  const actions = calls.filter(call => call.command).map(call => call.command.action);
  assert.deepEqual(actions.filter(action => action === 'pause' || action === 'resume'), ['resume', 'pause', 'resume']);
  assert.equal(actions.at(-1), 'stop');
  assert.equal(listeners.size, 0);
  assert.equal(runner.loaded, false);
  assert.equal(runner.isRunning, false);
  for (const { options } of calls) assert.equal(options.headers['X-GameEmulator-TV'], '1');
});

test('repeated playback updates and native pause notifications only transition once', async () => {
  const { runner, calls, listeners } = setup();
  const errors = [];
  runner.onError = error => errors.push(error.message);
  const notifyPause = listeners.get('tv-native-pause');
  notifyPause(); // The host may stop while still in the library.
  await runner.loadRom(new Uint8Array(16));
  notifyPause(); // Loading a ROM leaves it paused until the page resumes it.
  runner.pause();
  runner.resume(); runner.resume(); runner.resume();
  await runner.saveState();
  assert.equal(calls.filter(call => call.command?.action === 'resume').length, 1);
  assert.equal(errors.length, 0);
  runner.pause(); runner.pause();
  await runner.saveState();
  assert.equal(calls.filter(call => call.command?.action === 'pause').length, 1);
  assert.equal(calls.filter(call => call.path === 'frame').length, 1);
  notifyPause();
  assert.equal(errors.length, 0);
  runner.resume();
  await runner.saveState();
  notifyPause(); notifyPause();
  assert.deepEqual(errors, ['游戏已暂停']);
  assert.equal(runner.isRunning, false);
  runner.resume();
  await runner.saveState();
  notifyPause();
  assert.equal(errors.length, 2); // A later genuine interruption still pauses.
  await runner.dispose();
  notifyPause();
  assert.equal(errors.length, 2);
});

test('a rejected native resume can be retried', async () => {
  let rejectResume = true;
  const { runner, calls } = setup({ command: options => {
    if (JSON.parse(options.body).action === 'resume' && rejectResume)
      return Response.json({ error: 'audio focus unavailable' }, { status: 400 });
  } });
  const errors = [];
  runner.onError = error => errors.push(error.message);
  await runner.loadRom(new Uint8Array(16));
  runner.resume();
  await runner.saveState();
  assert.equal(runner.isRunning, false);
  assert.deepEqual(errors, ['audio focus unavailable']);
  rejectResume = false;
  runner.resume();
  await runner.saveState();
  assert.equal(runner.isRunning, true);
  assert.equal(calls.filter(call => call.command?.action === 'resume').length, 2);
  await runner.dispose();
});
