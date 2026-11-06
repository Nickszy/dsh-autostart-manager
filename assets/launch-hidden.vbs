' launch-hidden.vbs - silent bootstrapper for DeepSeek Harness autostart.
' Installed by dsh-autostart-manager into %DSH_HOME%\autostart.
' Runs under wscript //B (no console), spawns the helper ps1 hidden.
Dim shell, dir, cmd
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\dsh-silent-start.ps1"""
shell.Run cmd, 0, False
