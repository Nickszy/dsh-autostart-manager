// Login helper for a local DSH Web service. Child output is deliberately not
// logged: DSH may print a one-time browser login token on stdout.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import net from 'node:net'
import { webArgs, localUrl } from './platforms/entries.mjs'

const configIndex = process.argv.indexOf('--config')
if (configIndex < 0 || !process.argv[configIndex + 1]) throw new Error('Missing --config')
const configPath = process.argv[configIndex + 1]
const dir = dirname(configPath)
const logPath = join(dir, 'startup.log')
const lockPath = join(dir, 'web-startup.lock')
const nonce = randomUUID()
let ownsLock = false
let child
function log(message) {
  try {
    if (existsSync(logPath) && statSync(logPath).size > 262144) renameSync(logPath, logPath + '.1')
    appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\n', { mode: 0o600 })
  } catch {}
}
function release() {
  if (!ownsLock) return
  try { if (JSON.parse(readFileSync(lockPath, 'utf8')).nonce === nonce) unlinkSync(lockPath) } catch {}
  ownsLock = false
}
function acquire() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce })) } finally { closeSync(fd) }
      ownsLock = true
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let existing
      try { existing = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { log('Lock unreadable; refusing duplicate startup.'); return false }
      if (!Number.isInteger(existing.pid) || existing.pid <= 0) { log('Lock invalid; refusing duplicate startup.'); return false }
      try { process.kill(existing.pid, 0); return false }
      catch (error) {
        if (error.code !== 'ESRCH') return false
        // Recheck before removing a stale lock written by another invocation.
        try { if (JSON.parse(readFileSync(lockPath, 'utf8')).nonce === existing.nonce) unlinkSync(lockPath) } catch {}
      }
    }
  }
  return false
}
function listening(url) {
  return new Promise(resolve => {
    const parsed = new URL(url)
    const socket = net.createConnection({ host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) })
    const done = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(1200, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
function browser(url) {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY || (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)) return
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  const opener = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true })
  opener.once('error', () => log('Could not open browser.'))
  opener.unref()
}
async function main() {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  if (cfg.target !== 'web') throw new Error('Configuration is not Web mode')
  const url = localUrl(cfg.web.url)
  if (!acquire()) { log('Web companion already running; skipped.'); return }
  process.on('exit', release)
  if (await listening(url)) {
    log('Configured address already responds; no additional service started.')
    if (cfg.mode === 'show') browser(url)
    release()
    return
  }
  const environment = { ...process.env, DSH_HOME: dirname(dir) }
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key]
  environment.PATH = dirname(cfg.web.runtime) + delimiter + (cfg.web.path || process.env.PATH || process.env.Path || '')
  child = spawn(cfg.web.executable, webArgs(cfg.web.args, cfg.mode), {
    cwd: cfg.web.cwd, env: environment, shell: false, windowsHide: true, stdio: 'ignore',
  })
  child.once('error', () => { log('Web service could not be started; check executable and arguments.'); release(); process.exitCode = 1 })
  child.once('spawn', () => log('Web service started pid=' + child.pid + ' mode=' + cfg.mode))
  child.once('exit', (code, signal) => { log('Web service exited code=' + code + ' signal=' + signal); release(); process.exitCode = code ?? 1 })
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { if (child && child.exitCode === null) child.kill(signal) })
}
main().catch(() => { log('Web startup failed; check saved startup settings.'); release(); process.exitCode = 1 })
