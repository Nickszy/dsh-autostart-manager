// Native login entries. Values are data, never interpolated into a shell command.
export function xml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
}
export function plist({ label, command, args, cwd, env }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${[command, ...args].map(value => `<string>${xml(value)}</string>`).join('')}</array>
${cwd ? `<key>WorkingDirectory</key><string>${xml(cwd)}</string>` : ''}
<key>EnvironmentVariables</key><dict>${Object.entries(env ?? {}).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
</dict></plist>\n`
}
export function desktopArg(value) {
  // Desktop Entry Exec quoting is not shell quoting. Escape field codes too.
  if (/[\x00-\x1f]/.test(String(value))) throw new Error('Invalid Desktop Entry argument')
  const quoted = String(value).replace(/%/g, '%%').replace(/[\\"`$]/g, char => '\\' + char)
  return '"' + quoted.replace(/\\/g, '\\\\') + '"'
}
export function desktopEntry({ command, args, cwd, disabled = false }) {
  const path = cwd ? `Path=${String(cwd).replace(/\\/g, '\\\\').replace(/ /g, '\\s')}\n` : ''
  return `[Desktop Entry]\nType=Application\nVersion=1.0\nName=DSH 开机自启\nComment=Start DeepSeek Harness after login\nExec=${[command, ...args].map(desktopArg).join(' ')}\n${path}Terminal=false\nHidden=${disabled}\nX-GNOME-Autostart-enabled=${!disabled}\n`
}
export function webArgs(args, mode) {
  // Let DSH open its authenticated startup URL; never log or rebuild its token.
  const result = args.filter(arg => arg !== '--no-open')
  if (mode !== 'show') result.push('--no-open')
  return result
}
export function localUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) {
    throw new Error('Web 地址必须是不含凭据的本机 HTTP(S) 地址。')
  }
  return url.href
}
