import { spawnSync } from 'node:child_process'
const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const APPROVED_ROOT = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved'
function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function registry(action = 'read', command = '', valueName = 'DeepSeekHarnessSilentStart') {
  // EncodedCommand preserves embedded quotes, Unicode and spaces in Run values.
  // Read and modify only this plugin's named value, never an entire key.
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $root = [Microsoft.Win32.Registry]::CurrentUser
  $name = ${psString(valueName)}
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
  if ($action -eq 'enable' -or $action -eq 'update') {
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

