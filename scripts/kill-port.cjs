const { spawnSync } = require('node:child_process')

const portArgument = process.argv[2]
const port = Number(portArgument)

if (process.argv.length !== 3 || !/^\d+$/.test(portArgument || '') || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('用法：node scripts/kill-port.cjs <端口号 1-65535>')
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  return result
}

try {
  const windows = process.platform === 'win32'
  const result = windows
    ? run('netstat', ['-ano', '-p', 'tcp'])
    : run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])

  // lsof returns 1 without output when no process is listening.
  if (result.status !== 0 && !(result.status === 1 && !windows && !result.stdout.trim() && !result.stderr.trim())) {
    throw new Error(result.stderr.trim() || `端口查询失败（退出码 ${result.status}）`)
  }

  const pids = new Set()
  for (const line of result.stdout.trim().split(/\r?\n/)) {
    let pid
    if (windows) {
      const fields = line.trim().split(/\s+/)
      if (fields[0] !== 'TCP' || fields[3] !== 'LISTENING' || !fields[1].endsWith(`:${port}`)) continue
      pid = Number(fields[4])
    } else {
      pid = Number(line.trim())
    }
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
  }

  for (const pid of pids) {
    if (windows) {
      const stopped = run('taskkill', ['/PID', String(pid), '/F'])
      if (stopped.status !== 0) throw new Error(stopped.stderr.trim() || `无法结束进程 ${pid}`)
    } else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
  console.log(pids.size ? `已释放端口 ${port}（PID: ${[...pids].join(', ')}）。` : `端口 ${port} 未被占用。`)
} catch (error) {
  console.error(`释放端口 ${port} 失败：${error.message}`)
  process.exitCode = 1
}
