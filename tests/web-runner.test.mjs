import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { createManager } from '../core.mjs'
const root = mkdtempSync(join(tmpdir(), 'dsh-web-runner-test-'))
const running = new Set()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  const end = Date.now() + 8000
  while (Date.now() < end) { if (check()) return; await delay(30) }
  throw new Error('Timed out waiting for fixture')
}
const fixture = join(root, 'test service.mjs')
writeFileSync(fixture, `import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
writeFileSync(join(process.cwd(), 'received.json'), JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), home: process.env.DSH_HOME, path: process.env.PATH}));
console.log('FAKE_LOGIN_TOKEN_DO_NOT_LOG'); console.error('FAKE_LOGIN_TOKEN_DO_NOT_LOG');
const timer = setInterval(() => { if (existsSync(join(process.cwd(), 'stop'))) { clearInterval(timer); process.exit(0) } }, 30);
setTimeout(() => process.exit(2), 12000).unref();`)
async function unusedPort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
function start(manager) {
  const child = spawn(process.execPath, [join(dirname(manager.configPath), 'web-runner.mjs'), '--config', manager.configPath], { stdio: 'inherit', windowsHide: true })
  running.add(child)
  const ended = once(child, 'exit').then(([code]) => { running.delete(child); assert.equal(code, 0) })
  return { child, ended }
}
try {
  for (const mode of ['silent', 'show']) {
    const home = join(root, mode); mkdirSync(home)
    const manager = createManager({ home, dshHome: join(home, '.dsh'), electron: false, argv: [], registry: () => ({ run: null }), run: () => ({ status: 0, stdout: '' }) })
    const web = { runtime: process.execPath, executable: process.execPath, args: [fixture, '--profile', 'fixture', '--no-open'], cwd: home, url: 'http://127.0.0.1:' + await unusedPort() + '/', path: 'fixture-search-path' }
    manager.update({ target: 'web', mode, web }); manager.installAssets()
    const first = start(manager)
    await until(() => existsSync(join(home, 'received.json')))
    const received = JSON.parse(readFileSync(join(home, 'received.json')))
    assert.equal(received.cwd, home); assert.equal(received.home, join(home, '.dsh'))
    assert.ok(received.path.endsWith('fixture-search-path'))
    assert.deepEqual(received.args, ['--profile', 'fixture', ...(mode === 'silent' ? ['--no-open'] : [])])
    const second = start(manager); await second.ended
    assert.ok(readFileSync(join(dirname(manager.configPath), 'startup.log'), 'utf8').includes('already running'))
    writeFileSync(join(home, 'stop'), '')
    await first.ended
    assert.equal(existsSync(join(dirname(manager.configPath), 'web-startup.lock')), false)
    assert.ok(!readFileSync(join(dirname(manager.configPath), 'startup.log'), 'utf8').includes('FAKE_LOGIN_TOKEN'))
    console.log('PASS: real Web helper ' + mode + ', argv/profile/cwd/PATH/home, concurrent launch and token-safe log')
  }
  const home = join(root, 'occupied'); mkdirSync(home)
  const listener = net.createServer(socket => socket.end()); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  try {
    const manager = createManager({ home, dshHome: join(home, '.dsh'), electron: false, argv: [], registry: () => ({ run: null }), run: () => ({ status: 0, stdout: '' }) })
    manager.update({ target: 'web', mode: 'silent', web: { runtime: process.execPath, executable: process.execPath, args: [fixture], cwd: home, url: 'http://127.0.0.1:' + listener.address().port + '/', path: '' } })
    manager.installAssets(); await start(manager).ended
    assert.equal(existsSync(join(home, 'received.json')), false)
    assert.ok(readFileSync(join(dirname(manager.configPath), 'startup.log'), 'utf8').includes('no additional service'))
    console.log('PASS: occupied local address prevents a second service')
  } finally { await new Promise(resolve => listener.close(resolve)) }
} finally {
  for (const child of running) child.kill()
  if (running.size) await delay(150)
  assert.ok(root.startsWith(join(tmpdir(), 'dsh-web-runner-test-')))
  rmSync(root, { recursive: true, force: true })
}
