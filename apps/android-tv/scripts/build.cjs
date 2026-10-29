const { spawnSync } = require('node:child_process');
const path = require('node:path');

const host = path.resolve(__dirname, '..');
const task = process.argv[2] || 'assembleDebug';
if (!['assembleDebug', 'assembleRelease', 'installDebug', 'testDebugUnitTest'].includes(task)) {
  throw new Error(`Unsupported Gradle task: ${task}`);
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, [require.resolve('vue-tsc/bin/vue-tsc.js'), '-b', '--force'], host);
run(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'], host);
const android = path.join(host, 'android');
if (process.platform === 'win32') {
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', task, '--console=plain'], android);
} else {
  run('sh', ['./gradlew', task, '--console=plain'], android);
}
