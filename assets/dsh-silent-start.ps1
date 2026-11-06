# Backward-compatible Windows entry point; source is ASCII for PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $dir 'dsh-autostart.config.json'
$cfg = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($cfg.target -eq 'web') {
  # Native argument passing; never use cmd /c, Invoke-Expression or a shell string.
  & ([string]$cfg.web.runtime) (Join-Path $dir 'web-runner.mjs') '--config' $configPath
  exit $LASTEXITCODE
}
& (Join-Path $dir 'dsh-tray.ps1')
