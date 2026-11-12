const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

test('saving and deleting native arcade states preserves the original WASM state', async () => {
  // Minimal asynchronous IndexedDB transport; exercise the actual storage functions.
  const records = new Map();
  const db = {
    transaction() {
      const transaction = { objectStore: () => ({
        getAll() {
          const request = {};
          queueMicrotask(() => {
            request.result = [...records.values()]; request.onsuccess?.();
            queueMicrotask(() => transaction.oncomplete?.());
          });
          return request;
        },
        put(record) { records.set(record.key, record); },
        delete(key) { records.delete(key); },
      }) };
      return transaction;
    },
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => { request.result = db; request.onsuccess(); });
    return request;
  } };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, '../../../packages/arcade/src/store/library.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const shared = {};
  const sharedCode = ts.transpileModule(readFileSync(resolve(__dirname, '../../../packages/shared/saveSlots.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(sharedCode, { exports: shared });
  runInNewContext(code, { exports, indexedDB, Blob, require: name => { assert.equal(name, '../../../shared/saveSlots'); return shared; } });
  const make = (coreBuild, byte, savedAt) => ({ key: `${coreBuild}:game`, gameName: 'game.zip', gameHash: 'hash', dependencies: [], coreBuild, state: new Blob([new Uint8Array([byte])]), savedAt });
  const wasm = make(exports.CORE_BUILD, 7, 1), native = make('fbalpha2012-0ce3153-native-v1', 8, 2);
  await exports.putSnapshot(wasm);
  await exports.putSnapshot(native);
  await exports.putSnapshot({ ...native, state: new Blob([new Uint8Array([9])]), savedAt: 3 });
  const list = await exports.listSnapshots();
  assert.equal(list.length, 2);
  assert.equal(new Uint8Array(await list.find(state => state.coreBuild === wasm.coreBuild).state.arrayBuffer())[0], 7);
  assert.equal(new Uint8Array(await list.find(state => state.coreBuild === native.coreBuild).state.arrayBuffer())[0], 9);
  await exports.removeSnapshot(native.key);
  const remaining = await exports.listSnapshots();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].key, wasm.key);
});
