const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path').posix;

const source = readFileSync(`${__dirname}/manifest-update.cjs`, 'utf8');
function run(names, options = {}) {
  const original = { version: '0.2.0', notes: 'desktop notes', platforms: { 'windows-x86_64': { url: 'desktop.exe', signature: 'sig' } } };
  let content = JSON.stringify(original);
  let uploaded;
  let cleaned = false;
  let calls = [];
  const fs = {
    mkdtempSync: () => '/tmp/test-manifest',
    readFileSync: () => content,
    writeFileSync: (_, value) => { content = value; },
    rmSync: () => { cleaned = true; },
  };
  const execFileSync = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    if (args[0] === 'api') return names.join('\n');
    if (args[1] === 'download' && options.failDownload) throw new Error('download failed');
    if (args[1] === 'upload') uploaded = JSON.parse(content);
    return '';
  };
  let error;
  try {
    runInNewContext(source, {
      require: (name) => ({ 'node:fs': fs, 'node:path': path, 'node:os': { tmpdir: () => '/tmp' }, 'node:child_process': { execFileSync } })[name],
      process: { env: { TAG: 'v0.2.0', VERSION: '0.2.0', NOTES: 'Android notes', ...options.env } },
      console: { log() {} },
    });
  } catch (e) { error = e; }
  return { original, uploaded, cleaned, calls, error };
}

test('prefers universal APK and preserves desktop manifest fields', () => {
  const r = run(['app_arm64.apk', 'app_universal.apk', 'app_x86.apk']);
  assert.ifError(r.error);
  assert.deepEqual(r.uploaded.platforms, r.original.platforms);
  assert.equal(r.uploaded.version, r.original.version);
  assert.equal(r.uploaded.notes, r.original.notes);
  assert.deepEqual(r.uploaded.android, {
    version: '0.2.0', notes: 'Android notes',
    url: 'https://github.com/while-coder/GameEmulator/releases/download/v0.2.0/app_universal.apk',
  });
  assert.equal(r.cleaned, true);
});

test('uses arm64 fallback as in ClipRoam', () => {
  const r = run(['app_x86.apk', 'app_aarch64.apk']);
  assert.ifError(r.error);
  assert.match(r.uploaded.android.url, /app_aarch64.apk$/);
});

test('fails without APK rather than publishing an invalid Android entry', () => {
  const r = run([]);
  assert.match(r.error.message, /APK/);
  assert.equal(r.uploaded, undefined);
  assert.equal(r.calls.length, 1);
});

test('does not overwrite manifest after download failure and cleans temporary directory', () => {
  const r = run(['app_universal.apk'], { failDownload: true });
  assert.match(r.error.message, /download failed/);
  assert.equal(r.uploaded, undefined);
  assert.equal(r.cleaned, true);
});

test('requires release metadata before making API calls', () => {
  const r = run(['app.apk'], { env: { VERSION: '' } });
  assert.match(r.error.message, /VERSION/);
  assert.equal(r.calls.length, 0);
});
