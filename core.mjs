import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plist, desktopEntry, localUrl } from './platforms/entries.mjs'
import { registry } from './platforms/windows.mjs'

export const version = '0.3.0'
const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets')
const cleanString = value => typeof value === 'string' && !/[\x00-\x1f]/.test(value)
function file(path) { try { return statSync(path).isFile() } catch { return false } }
function directory(path) { try { return statSync(path).isDirectory() } catch { return false } }
function atomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameSync(temp, path) }
  finally { try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
export function createManager(options = {}) {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(home, '.dsh')
  const dir = join(dshHome, 'autostart')
  const configPath = join(dir, 'dsh-autostart.config.json')
  const run = options.run ?? spawnSync
  const start = options.spawn ?? spawn
  const reg = options.registry ?? registry
  const node = options.execPath ?? process.execPath
  const argv = options.argv ?? process.argv
  const electron = options.electron ?? Boolean(process.versions.electron)
  const desktopHost = electron || argv.some(arg => arg.includes('dsh-desktop-host'))
  const hash = createHash('sha256').update(dshHome).digest('hex').slice(0, 12)
  const label = 'ai.deepseek.dsh.autostart.' + hash
  const defaultHome = join(home, '.dsh')
  const valueName = dshHome === defaultHome ? 'DeepSeekHarnessSilentStart' : 'DeepSeekHarnessStartup-' + hash
  const entryPath = platform === 'darwin' ? join(home, 'Library', 'LaunchAgents', label + '.plist')
    : join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config'), 'autostart', 'dsh-autostart-' + hash + '.desktop')
  const uid = options.uid ?? (process.getuid?.() ?? 0)

  function runtimeDefault() {
    if (!electron && file(node)) return node
    const candidates = platform === 'win32' ? [
      join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
      join(dirname(node), 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    ] : []
    return candidates.find(file) ?? ''
  }
  function desktopDefault() {
    if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
    if (platform === 'darwin') {
      const index = node.indexOf('.app/')
      if (index >= 0) return node.slice(0, index + 4)
      return [join(home, 'Applications', 'DeepSeek Harness.app'), '/Applications/DeepSeek Harness.app'].find(directory) ?? '/Applications/DeepSeek Harness.app'
    }
    return electron ? node : ''
  }
  function defaults() {
    let url = ''
    try { const parsed = new URL(env.DSH_WEB_URL); parsed.search = ''; parsed.hash = ''; url = localUrl(parsed.href) } catch {}
    const cli = !desktopHost && argv[1] && /dsh|deepseek/i.test(argv[1]) && file(argv[1])
    return {
      target: desktopHost ? 'desktop' : 'web', mode: platform === 'linux' && desktopHost ? 'show' : 'silent', exe: desktopDefault(),
      web: { runtime: runtimeDefault(), executable: cli ? node : '', args: cli ? argv.slice(1) : ['--profile', 'web'], cwd: options.cwd ?? process.cwd(), url, path: env.PATH ?? env.Path ?? '' },
    }
  }
  function readConfig() {
    const base = defaults()
    try {
      const saved = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
      // v0.2.0 had only mode/exe, and always referred to the desktop client.
      return { ...base, ...saved, target: ['desktop', 'web'].includes(saved.target) ? saved.target : 'desktop', web: { ...base.web, ...saved.web } }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('启动配置无法读取，请检查配置文件。')
      return base
    }
  }
  function executable(path, allowApp = false) {
    if (!cleanString(path) || !isAbsolute(path)) return false
    if (allowApp && platform === 'darwin' && path.endsWith('.app')) return directory(path)
    if (!file(path)) return false
    if (platform === 'win32') return extname(path).toLowerCase() === '.exe'
    try { accessSync(path, constants.X_OK); return true } catch { return false }
  }
  function validate(cfg) {
    if (!['desktop', 'web'].includes(cfg.target) || !['show', 'silent'].includes(cfg.mode)) throw new Error('请选择有效的启动方式。')
    if (cfg.target === 'desktop') {
      if (!executable(cfg.exe, true) || (platform === 'darwin' && !cfg.exe.endsWith('.app'))) throw new Error('找不到有效的客户端程序，请检查客户端位置。')
      if (platform === 'linux' && cfg.mode !== 'show') throw new Error('Linux 客户端暂不支持通用静默启动。')
    } else {
      const web = cfg.web
      if (!executable(web.runtime) || !executable(web.executable)) throw new Error('请设置有效的 Node.js 和 Web 启动程序路径。')
      if (!Array.isArray(web.args) || !web.args.every(cleanString) || web.args.length === 0) throw new Error('启动参数必须是非空的字符串数组。')
      if (!cleanString(web.cwd) || !isAbsolute(web.cwd) || !directory(web.cwd)) throw new Error('请选择有效的工作目录。')
      localUrl(web.url)
      if (!cleanString(web.path)) throw new Error('程序搜索路径无效。')
    }
    return cfg
  }
  function writeConfig(cfg) {
    const clean = {
      target: cfg.target, mode: cfg.mode, exe: cfg.exe,
      web: { runtime: cfg.web.runtime, executable: cfg.web.executable, args: cfg.web.args, cwd: cfg.web.cwd, url: cfg.web.url, path: cfg.web.path },
    }
    atomic(configPath, JSON.stringify(clean, null, 2) + '\n')
  }
  function installAssets() {
    if (!supported()) return
    mkdirSync(dir, { recursive: true })
    for (const name of ['launch-hidden.vbs', 'dsh-silent-start.ps1', 'dsh-tray.ps1', 'web-runner.mjs']) copyFileSync(join(assets, name), join(dir, name))
    mkdirSync(join(dir, 'platforms'), { recursive: true })
    copyFileSync(join(assets, '..', 'platforms', 'entries.mjs'), join(dir, 'platforms', 'entries.mjs'))
  }
  function command(cfg) {
    if (platform === 'win32') return { command: 'wscript.exe', args: ['//B', join(dir, 'launch-hidden.vbs')] }
    if (cfg.target === 'web') return { command: cfg.web.runtime, args: [join(dir, 'web-runner.mjs'), '--config', configPath] }
    if (platform === 'darwin') return { command: '/usr/bin/open', args: [...(cfg.mode === 'silent' ? ['-g', '-j'] : []), '-a', cfg.exe] }
    return { command: cfg.exe, args: [] }
  }
  function bootstrap() { return `wscript.exe //B "${join(dir, 'launch-hidden.vbs')}"` }
  function nativeStatus(cfg) {
    if (platform === 'win32') {
      const { run: value, startupApproved = [] } = reg('read', '', valueName)
      return { registered: value !== null, bootstrapMatches: value === bootstrap(), systemDisabled: startupApproved.some(item => item.status === 'disabled'), startupApproved }
    }
    const content = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : null
    if (platform === 'darwin') {
      const result = run('/bin/launchctl', ['print-disabled', `gui/${uid}`], { encoding: 'utf8', timeout: 5000 })
      const systemDisabled = String(result.stdout ?? '').includes(`"${label}" => true`)
      return { registered: content !== null, bootstrapMatches: content === render(cfg), systemDisabled, systemStateUnknown: result.status !== 0 }
    }
    const systemDisabled = /^(?:Hidden\s*=\s*true|X-GNOME-Autostart-enabled\s*=\s*false)\s*$/im.test(content ?? '')
    return { registered: content !== null, bootstrapMatches: content === render(cfg, systemDisabled), systemDisabled }
  }
  function render(cfg, disabled = false) {
    const launch = command(cfg)
    const environment = cfg.target === 'web' ? { DSH_HOME: dshHome, PATH: cfg.web.path } : {}
    return platform === 'darwin' ? plist({ label, ...launch, cwd: cfg.target === 'web' ? cfg.web.cwd : home, env: environment })
      : desktopEntry({ ...launch, cwd: cfg.target === 'web' ? cfg.web.cwd : home, disabled })
  }
  function supported() { return ['win32', 'darwin', 'linux'].includes(platform) }
  function requirePlatform() { if (!supported()) throw new Error('当前系统暂不支持开机自启。') }
  function state() {
    if (!supported()) return { supported: false, platform, version }
    const cfg = readConfig()
    const native = nativeStatus(cfg)
    let valid = true, problem = ''
    try { validate(cfg) } catch (error) { valid = false; problem = error.message }
    return {
      supported: true, version, platform, ...native,
      enabled: native.registered && native.bootstrapMatches && !native.systemDisabled,
      target: cfg.target, mode: cfg.mode, exe: cfg.exe, web: cfg.web,
      exeExists: cfg.target === 'desktop' ? executable(cfg.exe, true) : executable(cfg.web.executable),
      valid, problem, silentSupported: cfg.target === 'web' || platform !== 'linux',
      traySupported: platform === 'win32' && cfg.target === 'desktop',
      helper: { vbs: existsSync(join(dir, 'launch-hidden.vbs')), ps1: existsSync(join(dir, 'dsh-silent-start.ps1')), tray: existsSync(join(dir, 'dsh-tray.ps1')), web: existsSync(join(dir, 'web-runner.mjs')) },
      dataDir: dir,
    }
  }
  function install(cfg, explicit = false) {
    if (platform === 'win32') reg(explicit ? 'enable' : 'update', bootstrap(), valueName)
    else {
      const disabled = !explicit && nativeStatus(cfg).systemDisabled
      if (platform === 'darwin' && explicit) {
        const result = run('/bin/launchctl', ['enable', `gui/${uid}/${label}`], { encoding: 'utf8', timeout: 5000 })
        if (result.status !== 0) throw new Error('无法开启 macOS 登录启动项；请在本机图形登录会话中重试。')
      }
      atomic(entryPath, render(cfg, disabled))
    }
  }
  function enable(payload = {}) {
    requirePlatform()
    const cfg = readConfig()
    if (payload.mode) cfg.mode = payload.mode
    validate(cfg); installAssets(); writeConfig(cfg); install(cfg, true)
    return state()
  }
  function disable() {
    requirePlatform()
    if (platform === 'win32') reg('disable', '', valueName)
    else if (existsSync(entryPath)) unlinkSync(entryPath)
    return state()
  }
  function update(payload) {
    requirePlatform()
    const old = readConfig()
    const cfg = { ...old, ...payload, web: { ...old.web, ...payload.web } }
    if (cfg.target === 'desktop' && platform === 'linux') cfg.mode = 'show'
    validate(cfg)
    const registered = nativeStatus(old).registered
    // Preserve the user's system-disabled state when changing preferences.
    const previous = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null
    writeConfig(cfg)
    try { if (registered) install(cfg, false) }
    catch (error) {
      if (previous === null) unlinkSync(configPath)
      else atomic(configPath, previous)
      throw error
    }
    return state()
  }
  async function launch() {
    requirePlatform()
    const cfg = validate(readConfig())
    installAssets()
    let launch = command(cfg)
    if (platform === 'win32') launch = { command: join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', join(dir, 'dsh-silent-start.ps1')] }
    return new Promise((resolve, reject) => {
      const child = start(launch.command, launch.args, { cwd: cfg.target === 'web' ? cfg.web.cwd : home, detached: true, stdio: 'ignore', windowsHide: true, env: { ...env, DSH_HOME: dshHome } })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve({ launched: true, mode: cfg.mode }) })
    })
  }
  return { state, enable, disable, update, launch, installAssets, readConfig, configPath, entryPath, render, command }
}
