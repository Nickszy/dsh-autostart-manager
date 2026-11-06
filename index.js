// dsh-autostart-manager — host half. Settings -> 开机自启.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-autostart-manager'
export const version = '0.2.0'
export const inject = ['connection']

const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const APPROVED_ROOT = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved'
const RUN_VALUE = 'DeepSeekHarnessSilentStart'

function defaultExe() {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(local, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
}

function dataDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'autostart')
}

function here() {
  return join(dirname(fileURLToPath(import.meta.url)), 'assets')
}

function readConfig(dir) {
  try {
    const j = JSON.parse(readFileSync(join(dir, 'dsh-autostart.config.json'), 'utf8'))
    return {
      mode: j?.mode === 'show' ? 'show' : 'silent',
      exe: typeof j?.exe === 'string' && j.exe ? j.exe : defaultExe(),
    }
  } catch {
    return { mode: 'silent', exe: defaultExe() }
  }
}

function writeConfig(dir, cfg) {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'dsh-autostart.config.json')
  const temporary = `${target}.${randomUUID()}.tmp`
  // Only user preferences belong on disk; discard old state/legacy fields.
  const clean = { mode: cfg.mode === 'show' ? 'show' : 'silent', exe: cfg.exe }
  try {
    writeFileSync(temporary, JSON.stringify(clean, null, 2), { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, target)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function validExe(exe) {
  if (typeof exe !== 'string' || !isAbsolute(exe) || extname(exe).toLowerCase() !== '.exe') return false
  try { return statSync(exe).isFile() } catch { return false }
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function registry(action = 'read', command = '') {
  // EncodedCommand preserves embedded quotes, Unicode and spaces in Run values.
  // Read and modify only this plugin's named value, never an entire key.
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $root = [Microsoft.Win32.Registry]::CurrentUser
  $name = ${psString(RUN_VALUE)}
  $runPath = ${psString(RUN_KEY)}
  $approvedRoot = ${psString(APPROVED_ROOT)}
  $action = ${psString(action)}
  $run = $null
  $runKey = $root.OpenSubKey($runPath, $false)
  try {
    if ($null -ne $runKey -and $runKey.GetValueNames() -contains $name) {
      $run = $runKey.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    }
  } finally { if ($null -ne $runKey) { $runKey.Dispose() } }
  $approved = @()
  foreach ($branch in @('Run', 'Run32')) {
    $key = $root.OpenSubKey(($approvedRoot + '\\' + $branch), $action -eq 'enable')
    $status = 'unknown'
    $present = $false
    try {
      if ($null -ne $key -and $key.GetValueNames() -contains $name) {
        $present = $true
        if ($key.GetValueKind($name) -eq [Microsoft.Win32.RegistryValueKind]::Binary) {
          $bytes = $key.GetValue($name)
          if ($bytes.Length -gt 0) {
            if ($bytes[0] -eq 2 -or $bytes[0] -eq 6) { $status = 'enabled' }
            elseif ($bytes[0] -eq 3 -or $bytes[0] -eq 7) { $status = 'disabled' }
          }
        }
        if ($action -eq 'enable' -and $status -eq 'disabled') {
          $key.DeleteValue($name, $false)
          $present = $false
          $status = 'unknown'
        }
      }
    } finally { if ($null -ne $key) { $key.Dispose() } }
    $approved += @{ branch = $branch; present = $present; status = $status }
  }
  if ($action -eq 'enable') {
    $key = $root.CreateSubKey($runPath)
    try { $key.SetValue($name, ${psString(command)}, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
  } elseif ($action -eq 'disable') {
    $key = $root.OpenSubKey($runPath, $true)
    try { if ($null -ne $key) { $key.DeleteValue($name, $false) } }
    finally { if ($null -ne $key) { $key.Dispose() } }
  }
  @{ run = $run; startupApproved = @($approved) } | ConvertTo-Json -Compress -Depth 5
} catch {
  [Console]::Error.WriteLine(($_ | Out-String))
  exit 1
}
`
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n')
    const error = new Error(`注册表 ${action} 失败 (exit=${result.status}, signal=${result.signal ?? 'none'}): ${detail || 'PowerShell 未返回诊断信息'}`)
    error.code = 'autostart/registry'
    throw error
  }
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()) } catch (cause) {
    const error = new Error(`注册表 ${action} 返回无效 JSON: ${cause.message}; stdout=${result.stdout}; stderr=${result.stderr}`)
    error.code = 'autostart/registry'
    throw error
  }
}

function bootstrapCommand(dir) {
  // Keep the existing VBS path so existing Run entries continue to match.
  return `wscript.exe //B "${join(dir, 'launch-hidden.vbs')}"`
}

function installAssets(dir) {
  mkdirSync(dir, { recursive: true })
  for (const asset of ['launch-hidden.vbs', 'dsh-silent-start.ps1', 'dsh-tray.ps1']) {
    copyFileSync(join(here(), asset), join(dir, asset))
  }
}

function stateView() {
  if (process.platform !== 'win32') {
    return { supported: false, platform: process.platform, version, note: 'macOS 支持规划中(将走 launchd),当前仅 Windows。' }
  }
  const dir = dataDir()
  const cfg = readConfig(dir)
  const { run, startupApproved } = registry()
  const registered = run !== null
  const bootstrapMatches = run === bootstrapCommand(dir)
  const systemDisabled = startupApproved.some(item => item.status === 'disabled')
  return {
    supported: true,
    platform: process.platform,
    version,
    enabled: registered && bootstrapMatches && !systemDisabled,
    registered,
    systemDisabled,
    startupApproved,
    mode: cfg.mode,
    exe: cfg.exe,
    exeExists: validExe(cfg.exe),
    runValue: run,
    bootstrapMatches,
    helper: {
      vbs: existsSync(join(dir, 'launch-hidden.vbs')),
      ps1: existsSync(join(dir, 'dsh-silent-start.ps1')),
      tray: existsSync(join(dir, 'dsh-tray.ps1')),
    },
    dataDir: dir,
  }
}

function ok(value) { return { ok: true, value } }
function fail(message, code = 'autostart/invalid') { return { ok: false, error: { code, message } } }
function exeFailure(exe) { return fail(`客户端 exe 必须是实际存在的绝对 .exe 文件路径: ${exe}`, 'autostart/no-exe') }

async function handle(ctx, endpoint, payload) {
  const view = stateView()
  if (endpoint === 'state') return ok(view)
  if (!view.supported) return fail(view.note, 'autostart/platform')
  const dir = dataDir()
  const p = payload ?? {}
  switch (endpoint) {
    case 'enable': {
      const cfg = readConfig(dir)
      if (p.mode === 'show' || p.mode === 'silent') cfg.mode = p.mode
      if (!validExe(cfg.exe)) return exeFailure(cfg.exe)
      installAssets(dir)
      writeConfig(dir, cfg)
      // Explicit enable clears only known disabled values belonging to us.
      registry('enable', bootstrapCommand(dir))
      return ok(stateView())
    }
    case 'disable': {
      registry('disable')
      return ok(stateView())
    }
    case 'setmode': {
      if (p.mode !== 'show' && p.mode !== 'silent') return fail('mode 必须是 show 或 silent')
      const cfg = readConfig(dir)
      cfg.mode = p.mode
      writeConfig(dir, cfg)
      return ok(stateView())
    }
    case 'set-exe': {
      if (!validExe(p.exe)) return exeFailure(p.exe)
      const cfg = readConfig(dir)
      cfg.exe = p.exe
      writeConfig(dir, cfg)
      return ok(stateView())
    }
    case 'launch-now': {
      const cfg = readConfig(dir)
      if (!validExe(cfg.exe)) return exeFailure(cfg.exe)
      installAssets(dir)
      return await new Promise(resolve => {
        const child = spawn('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
          '-WindowStyle', 'Hidden', '-File', join(dir, 'dsh-silent-start.ps1'),
        ], { detached: true, stdio: 'ignore', windowsHide: true })
        child.once('error', error => resolve(fail(`启动 PowerShell 失败: ${error.message}`, 'autostart/launch')))
        child.once('spawn', () => {
          child.unref()
          resolve(ok({ launched: true, mode: cfg.mode }))
        })
      })
    }
    default:
      return fail(`未知接口: ${endpoint}`)
  }
}

function installApi(ctx) {
  return ctx.connection.fetch.register({
    path: '/api/dsh-autostart-manager',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let body = {}
      try { body = await request.json() } catch { body = {} }
      let result
      try {
        result = await handle(ctx, String(body?.endpoint ?? ''), body?.payload ?? null)
      } catch (error) {
        result = fail(String(error?.message ?? error), error?.code === 'autostart/registry' ? error.code : 'autostart/internal')
      }
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
}

export function apply(ctx) {
  if (process.platform === 'win32') {
    // Refresh scripts on startup; state inspection itself never writes config.
    try { installAssets(dataDir()) } catch { /* surfaced via status helper flags */ }
  }
  ctx.effect(() => installApi(ctx), 'autostart-manager: management api')
}
