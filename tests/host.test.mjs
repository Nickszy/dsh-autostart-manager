import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), 'dsh-autostart-test-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = temporary
let run = null
let approval = []
const actions = []
let spawnCount = 0
const bootstrap = `wscript.exe //B "${join(temporary, 'autostart', 'launch-hidden.vbs')}"`
globalThis.__autostartTest = {
  spawnSync(command, args, options) {
    assert.equal(options.windowsHide, true)
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
    const action = /\$action = '([^']+)'/.exec(script)[1]
    actions.push(action)
    const before = run
    if (action === 'enable') {
      run = bootstrap
      approval = approval.map(item => item.status === 'disabled' ? { ...item, status: 'unknown', present: false } : item)
    }
    if (action === 'disable') run = null
    assert.ok(script.includes('$key.DeleteValue($name, $false)'))
    assert.ok(script.includes("$action -eq 'enable' -and $status -eq 'disabled'"))
    return { status: 0, stdout: JSON.stringify({ run: before, startupApproved: approval }), stderr: '' }
  },
  spawn(command, args, options) {
    spawnCount++
    assert.ok(args.includes('-STA'))
    assert.equal(options.stdio, 'ignore')
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => child.emit('spawn'))
    return child
  },
}
try {
  let source = readFileSync(join(root, 'index.js'), 'utf8')
  source = source.replace("import { spawn, spawnSync } from 'node:child_process'", 'const { spawn, spawnSync } = globalThis.__autostartTest')
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(join(root, 'index.js')).href))
  const host = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  let api
  host.apply({
    connection: { fetch: { register(options) { api = options.fetch; return () => {} } } },
    effect(callback) { callback() },
  })
  async function call(endpoint, payload) {
    return (await api(new Request('http://localhost/api/dsh-autostart-manager', {
      method: 'POST', body: JSON.stringify({ endpoint, payload }),
    }))).json()
  }
  assert.equal((await call('state')).value.enabled, false)
  assert.equal((await call('set-exe', { exe: './missing.exe' })).ok, false)
  assert.equal((await call('set-exe', { exe: root })).ok, false)
  const fakeExe = join(temporary, 'client.exe')
  writeFileSync(fakeExe, 'test fixture; never executed')
  assert.equal((await call('set-exe', { exe: fakeExe })).ok, true)
  assert.equal((await call('enable', { mode: 'silent' })).value.enabled, true)
  assert.ok(existsSync(join(temporary, 'autostart', 'dsh-tray.ps1')))
  approval = [{ branch: 'Run', present: true, status: 'disabled' }]
  assert.equal((await call('state')).value.enabled, false)
  assert.equal((await call('state')).value.systemDisabled, true)
  const before = actions.length
  assert.equal((await call('launch-now')).ok, true)
  assert.equal(spawnCount, 1)
  assert.ok(actions.slice(before).every(action => action === 'read'))
  assert.equal((await call('state')).value.systemDisabled, true)
  assert.equal((await call('enable')).value.enabled, true)
  assert.equal((await call('setmode', { mode: 'show' })).value.mode, 'show')
  assert.equal((await call('setmode', { mode: 'bogus' })).ok, false)
  const snapshot = readFileSync(join(temporary, 'autostart', 'dsh-autostart.config.json'), 'utf8')
  await call('state')
  assert.equal(readFileSync(join(temporary, 'autostart', 'dsh-autostart.config.json'), 'utf8'), snapshot)
  assert.equal((await call('disable')).value.registered, false)
  console.log('PASS: startup state, explicit enable, disabled state preservation, path checks, configuration, launch and assets')
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  delete globalThis.__autostartTest
  // temporary is created by this test, under the OS temp directory.
  assert.ok(temporary.startsWith(join(tmpdir(), 'dsh-autostart-test-')))
  rmSync(temporary, { recursive: true, force: true })
}
