# Desktop startup companion. ASCII source for Windows PowerShell 5.1.
param([switch]$Attach)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $dir 'startup.log'
function Write-Log([string]$message) {
  try {
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 262144) {
      Move-Item -LiteralPath $logPath -Destination ($logPath + '.1') -Force
    }
    Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' ' + $message) -Encoding UTF8
  } catch {}
}
$mutex = $null
$ownsMutex = $false
$notify = $null
$timer = $null
$icon = $null
$script:handles = @()
try {
  $cfg = Get-Content -LiteralPath (Join-Path $dir 'dsh-autostart.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $exe = [IO.Path]::GetFullPath([string]$cfg.exe)
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or [IO.Path]::GetExtension($exe) -ine '.exe') { throw 'Client executable not found.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exe.ToLowerInvariant()))).Replace('-', '') }
  finally { $sha.Dispose() }
  $mutex = New-Object Threading.Mutex($false, ('Local\DSHDesktopTray-' + $hash))
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { Write-Log 'Companion already running; skipped.'; exit 0 }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DshDesktopWindow {
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
  public static IntPtr[] Find(int pid) {
    var found = new List<IntPtr>();
    EnumWindows((h, d) => { uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner == pid && GetWindowTextLength(h) > 0) found.Add(h); return true; }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
  [Windows.Forms.Application]::EnableVisualStyles()
  $script:target = $null
  # The desktop root starts before its Electron children. Avoid WMI at login.
  $matches = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $exe } | Sort-Object StartTime)
  $root = $matches | Select-Object -First 1
  $script:hidePending = $false
  if ($root) {
    $script:target = $root
    Write-Log ('Attached to existing client pid=' + $script:target.Id + '; visibility preserved.')
  } elseif ($Attach) {
    Write-Log 'No existing client to attach.'
    exit 0
  } else {
    $script:target = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
    $script:hidePending = $cfg.mode -ne 'show'
    Write-Log ('Started client pid=' + $script:target.Id + ' mode=' + $cfg.mode)
  }
  $script:deadline = (Get-Date).AddSeconds(60)
  $notify = New-Object Windows.Forms.NotifyIcon
  try { $icon = [Drawing.Icon]::ExtractAssociatedIcon($exe) } catch { $icon = [Drawing.SystemIcons]::Application.Clone() }
  $notify.Icon = $icon
  $notify.Text = 'DeepSeek Harness'
  $menu = New-Object Windows.Forms.ContextMenuStrip
  $open = $menu.Items.Add([string]::Concat([char]0x6253,[char]0x5F00,' DeepSeek Harness'))
  $open.add_Click({
    $script:hidePending = $false
    foreach ($handle in [DshDesktopWindow]::Find($script:target.Id)) {
      [void][DshDesktopWindow]::ShowWindowAsync($handle, 9)
      [void][DshDesktopWindow]::SetForegroundWindow($handle)
    }
    Write-Log 'Open requested.'
  })
  [void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
  $quit = $menu.Items.Add([string]::Concat([char]0x9000,[char]0x51FA,' DeepSeek Harness'))
  $quit.add_Click({
    $script:hidePending = $false
    foreach ($handle in [DshDesktopWindow]::Find($script:target.Id)) {
      [void][DshDesktopWindow]::ShowWindowAsync($handle, 9)
      [void][DshDesktopWindow]::PostMessage($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    Write-Log 'Client close requested.'
  })
  $detach = $menu.Items.Add((-join @([char]0x9000,[char]0x51FA,[char]0x6258,[char]0x76D8)))
  $detach.add_Click({ [Windows.Forms.Application]::ExitThread() })
  $notify.ContextMenuStrip = $menu
  $notify.add_DoubleClick({ $open.PerformClick() })
  $notify.Visible = $true
  Write-Log 'Tray ready.'
  $timer = New-Object Windows.Forms.Timer
  $timer.Interval = 100
  $timer.add_Tick({
    try {
      $script:target.Refresh()
      if ($script:target.HasExited) { Write-Log 'Client exited.'; [Windows.Forms.Application]::ExitThread(); return }
      if ($script:hidePending) {
        $script:handles = @([DshDesktopWindow]::Find($script:target.Id) | Where-Object { [DshDesktopWindow]::IsWindowVisible($_) })
        if ($script:handles.Count -gt 0) {
          # Never hide the client until its recovery icon is available.
          foreach ($handle in $script:handles) { [void][DshDesktopWindow]::ShowWindowAsync($handle, 0) }
          $script:hidePending = $false
          Write-Log 'Startup window hidden.'
        } elseif ((Get-Date) -gt $script:deadline) {
          $script:hidePending = $false
          Write-Log 'Window detection timed out; client visibility preserved.'
        }
      }
    } catch { Write-Log ('Monitor error: ' + $_.Exception.Message); [Windows.Forms.Application]::ExitThread() }
  })
  $timer.Start()
  [Windows.Forms.Application]::Run()
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.ScriptLineNumber + ' ' + $_.ScriptStackTrace)
  exit 1
} finally {
  if ($timer) { $timer.Stop(); $timer.Dispose() }
  # On companion exit/failure, restore any window we hid so it cannot be stranded.
  foreach ($handle in $script:handles) {
    if ([DshDesktopWindow]::IsWindow($handle)) { [void][DshDesktopWindow]::ShowWindowAsync($handle, 9) }
  }
  if ($notify) { $notify.Visible = $false; $notify.Dispose() }
  if ($icon) { $icon.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
