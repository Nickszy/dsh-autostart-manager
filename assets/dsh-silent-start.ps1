# Backward-compatible entry point for existing startup registration.
$ErrorActionPreference = 'Stop'
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'dsh-tray.ps1')
