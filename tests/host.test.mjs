import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createManager } from '../core.mjs'
import { plist, desktopArg, localUrl, webArgs } from '../platforms/entries.mjs'
const root = mkdtempSync(join(tmpdir(), 'dsh-autostart-cross-platform-'))
try {
  const exe = join(root, 'Desktop client.exe')
  writeFileSync(exe, 'fixture, never executed'); chmodSync(exe, 0o755)
  const app = join(root, 'Desktop & client.app'); mkdirSync(app)
  const starts = []
  const spawn = (command, args, options) => {
    starts.push({ command, args, options })
    const child = new EventEmitter(); child.unref = () => {}
    queueMicrotask(() => child.emit('spawn')); return child
  }
  const web = { runtime: process.execPath, executable: process.execPath, args: ['test cli.js', '--profile', 'web', '--port', '8080'], cwd: root, url: 'http://127.0.0.1:8080/', path: process.env.PATH || process.env.Path || '' }
  for (const platform of ['win32', 'darwin', 'linux']) {
    const home = join(root, platform); mkdirSync(home)
    let value = null, disabled = false
    const actions = []
    const registry = (action, command, name) => {
      actions.push(action)
      if (action === 'enable') { value = command; disabled = false }
      if (action === 'update') value = command
      if (action === 'disable') value = null
      return { run: value, startupApproved: [{ status: disabled ? 'disabled' : 'enabled' }] }
    }
    const manager = createManager({ platform, home, dshHome: join(home, '.dsh'), env: { PATH: web.path }, registry,
      run: (command, args) => {
        if (args[0] === 'enable') disabled = false
        return { status: 0, stdout: disabled ? `"${manager.entryPath.split(/[\\/]/).at(-1).replace('.plist', '')}" => true` : '' }
      }, spawn, electron: false, argv: ['node', 'fixture.mjs'], uid: 501,
    })
    assert.equal(manager.state().enabled, false)
    assert.throws(() => manager.update({ target: 'web', web: { ...web, url: 'https://example.com/' } }))
    assert.throws(() => manager.update({ target: 'web', web: { ...web, args: ['ok\nHidden=false'] } }))
    manager.update({ target: 'web', mode: 'silent', web })
    assert.equal(manager.enable().enabled, true)
    const snapshot = readFileSync(manager.configPath, 'utf8')
    manager.state(); assert.equal(readFileSync(manager.configPath, 'utf8'), snapshot)
    assert.ok(existsSync(join(home, '.dsh', 'autostart', 'web-runner.mjs')))
    if (platform === 'win32' || platform === 'darwin') disabled = true
    else writeFileSync(manager.entryPath, readFileSync(manager.entryPath, 'utf8').replace('Hidden=false', 'Hidden=true').replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'))
    assert.equal(manager.state().systemDisabled, true)
    manager.update({ mode: 'show' })
    assert.equal(manager.state().systemDisabled, true, 'Saving preferences must preserve system disable')
    const before = actions.length
    await manager.launch()
    assert.ok(actions.slice(before).every(action => action === 'read'), 'Manual launch must not re-enable startup')
    assert.equal(manager.state().systemDisabled, true)
    assert.equal(manager.enable().enabled, true)
    assert.equal(manager.disable().registered, false)
    manager.update({ target: 'desktop', exe: platform === 'darwin' ? app : exe, mode: 'silent' })
    assert.equal(manager.state().mode, platform === 'linux' ? 'show' : 'silent')
    assert.equal(manager.enable().enabled, true)
    if (platform === 'darwin') {
      const content = readFileSync(manager.entryPath, 'utf8')
      assert.ok(content.includes('&amp;'))
      assert.ok(content.includes('<string>-j</string>'))
      assert.ok(content.includes('<key>KeepAlive</key><false/>'))
      writeFileSync(join(root, 'example.plist'), content)
    }
    if (platform === 'linux') {
      assert.equal(manager.state().silentSupported, false)
      const entry = readFileSync(manager.entryPath, 'utf8')
      assert.ok(entry.includes('Terminal=false'))
      assert.ok(!entry.includes('sh -c'))
    }
    manager.disable()
    console.log('PASS: ' + platform + ' lifecycle, Web/desktop, disabled state, config and launch')
  }
  // A failed OS entry update must not leave new preferences pointing at old assets.
  const failureHome = join(root, 'failed-update')
  let rejectUpdate = false
  const failure = createManager({ platform: 'win32', home: failureHome, dshHome: join(failureHome, '.dsh'), registry: action => {
    if (action === 'update' && rejectUpdate) throw new Error('Simulated registry denial')
    return { run: 'registered fixture' }
  } })
  failure.update({ target: 'desktop', exe, mode: 'silent' })
  const beforeFailure = readFileSync(failure.configPath, 'utf8')
  rejectUpdate = true
  assert.throws(() => failure.update({ mode: 'show' }), /Simulated registry denial/)
  assert.equal(readFileSync(failure.configPath, 'utf8'), beforeFailure)
  console.log('PASS: failed native update rolls back configuration')
  // Legacy v0.2.0 data remains a desktop configuration, without writes on reads.
  const home = join(root, 'legacy'); mkdirSync(join(home, '.dsh', 'autostart'), { recursive: true })
  const legacyPath = join(home, '.dsh', 'autostart', 'dsh-autostart.config.json')
  const old = JSON.stringify({ exe, mode: 'silent' }); writeFileSync(legacyPath, old)
  const legacy = createManager({ platform: 'win32', home, dshHome: join(home, '.dsh'), registry: () => ({ run: null }), electron: false, argv: [] })
  assert.equal(legacy.state().target, 'desktop'); assert.equal(readFileSync(legacyPath, 'utf8'), old)
  assert.deepEqual(webArgs(['--profile', 'web', '--no-open'], 'show'), ['--profile', 'web'])
  assert.deepEqual(webArgs(['--profile', 'web'], 'silent'), ['--profile', 'web', '--no-open'])
  for (const url of ['https://user:pass@localhost/', 'http://example.com/', 'file:///tmp/', 'http://127.0.0.1/?token=secret']) assert.throws(() => localUrl(url))
  assert.equal(localUrl('http://[::1]:8080/'), 'http://[::1]:8080/')
  assert.throws(() => desktopArg('injected\nHidden=false'))
  assert.ok(desktopArg('50% "$HOME"').includes('50%%'))
  assert.ok(plist({ label: 'a&b', command: '<bad>', args: ['"quote"'], env: {} }).includes('&lt;bad&gt;'))
  const unsupported = createManager({ platform: 'freebsd', home: root })
  assert.equal(unsupported.state().supported, false)
  assert.throws(() => unsupported.enable())
  console.log('PASS: legacy migration, URL restrictions, quoting and unsupported platform')
} finally {
  assert.ok(root.startsWith(join(tmpdir(), 'dsh-autostart-cross-platform-')))
  rmSync(root, { recursive: true, force: true })
}
