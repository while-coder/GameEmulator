const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(readFileSync(resolve(__dirname, '../../../packages/android-native/src/transport.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
test('ordinary Android transport preserves binary bytes and propagates native errors', async () => {
  const exports = {}, sent = [];
  const bridge = { onmessage: null, postMessage(message) {
    const request = JSON.parse(message); sent.push(request);
    bridge.onmessage({ data: JSON.stringify(request.path.endsWith('fail') ? { id: request.id, error: 'native failure' } : { id: request.id, body: request.body, mime: 'application/octet-stream' }) });
  } };
  runInNewContext(code, { exports, window: { GameEmulatorNative: bridge, setTimeout }, clearTimeout, Response, Uint8Array, btoa, atob });
  const transport = exports.createWebViewTransport();
  const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, index) => index % 256);
  const response = await transport('/native/arcade/upload/game.zip/0', 'POST', bytes);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(sent[0].method, 'POST');
  await assert.rejects(transport('/native/nes/fail', 'GET'), /native failure/);
});
test('ordinary Android never falls back to WASM when the native bridge is missing', async () => {
  const exports = {};
  runInNewContext(code, { exports, window: {}, Uint8Array });
  await assert.rejects(exports.createWebViewTransport()('/native/nes/info', 'GET'), /通道未加载/);
});
