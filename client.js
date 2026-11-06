// Settings UI for dsh-autostart-manager.
window.__ModuleLoader__.load({
  id: 'dsh-autostart-manager',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React
    const module = { exports: {} }

    async function call(endpoint, payload) {
      const res = await fetch('api/dsh-autostart-manager', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload: payload ?? null }),
      })
      if (!res.ok) throw new Error('暂时无法保存，请稍后重试。')
      const body = await res.json()
      if (!body || body.ok !== true) {
        const messages = {
          'autostart/no-exe': '找不到有效的客户端程序，请检查客户端位置。',
          'autostart/registry': '无法更新开机自启设置，请稍后重试。',
          'autostart/launch': '启动失败，请检查客户端位置后重试。',
          'autostart/platform': '当前系统暂不支持此设置。',
        }
        throw new Error(messages[body?.error?.code] || '操作失败，请重试。')
      }
      return body.value
    }

    const S = {
      card: { border: '1px solid var(--bt-line-2, rgba(20,20,20,.15))', borderRadius: 10, padding: '16px', color: 'var(--bt-ink, #141414)', background: 'var(--bt-card, #fff)', fontSize: 13, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' },
      muted: { color: 'var(--bt-ink-2, rgba(20,20,20,.6))', fontSize: 12 },
      btn: { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--bt-line-2, rgba(20,20,20,.15))', background: 'var(--bt-card, #fff)', color: 'var(--bt-ink, #141414)', cursor: 'pointer', fontSize: 13 },
      error: { color: 'var(--bt-danger, #e02135)', marginTop: 8 },
    }

    function Panel() {
      const [s, setS] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const refresh = useCallback(async () => {
        try { setS(await call('state')); setError(null) }
        catch { setError('暂时无法读取设置，请稍后重试。') }
      }, [])
      useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 10000)
        return () => clearInterval(timer)
      }, [refresh])

      const act = async (endpoint, payload) => {
        setBusy(true); setError(null)
        try { await call(endpoint, payload); await refresh() }
        catch (e) { setError(e.message || '操作失败，请重试。') }
        finally { setBusy(false) }
      }
      const toggle = (label, checked, disabled, onChange) => h('input', {
        type: 'checkbox', role: 'switch', 'aria-label': label,
        checked, disabled, onChange, style: { width: 18, height: 18, accentColor: 'var(--bt-accent, #4d6bfe)', flexShrink: 0 },
      })

      if (!s) return h('div', { style: S.card }, error || '加载中…')
      if (!s.supported) return h('div', { style: S.card }, '当前系统暂不支持开机自启设置。')
      const enabled = s.enabled && s.bootstrapMatches
      const needsRepair = (s.registered ?? s.enabled) && !s.systemDisabled && (!s.bootstrapMatches || !s.helper?.vbs || !s.helper?.ps1 || s.helper?.tray === false)
      return h('div', { style: S.card },
        h('label', { style: S.row },
          h('div', null,
            h('div', null, '开机自启'),
            h('div', { style: S.muted }, '登录电脑后自动启动 DeepSeek Harness'),
          ),
          toggle('开机自启', enabled, busy, e => act(e.target.checked ? 'enable' : 'disable')),
        ),
        h('label', { style: S.row },
          h('div', null, '自启时显示主窗口'),
          toggle('自启时显示主窗口', s.mode === 'show', busy || !enabled,
            e => act('setmode', { mode: e.target.checked ? 'show' : 'silent' })),
        ),
        s.systemDisabled ? h('div', { style: S.muted }, '已在 Windows 启动应用中关闭。') : null,
        enabled && s.mode === 'silent' ? h('div', { style: S.muted }, '启动后收起到托盘，窗口可能短暂出现。') : null,
        !s.exeExists ? h('div', { style: S.error }, '找不到客户端，请在高级设置中更新位置。') : null,
        needsRepair ? h('div', { style: S.error },
          '自启设置需要修复。 ',
          h('button', { style: S.btn, disabled: busy, onClick: () => act('enable') }, '修复'),
        ) : null,
        error ? h('div', { style: S.error, role: 'alert' }, error) : null,
        h('details', { style: { marginTop: 16 } },
          h('summary', { style: { ...S.muted, cursor: 'pointer' } }, '高级设置'),
          h('div', { style: { ...S.muted, marginTop: 10, overflowWrap: 'anywhere' } }, '客户端位置：', s.exe),
          h('button', {
            style: { ...S.btn, marginTop: 8 }, disabled: busy,
            onClick: () => {
              const path = prompt('选择客户端程序的位置', s.exe)
              if (path?.trim()) act('set-exe', { exe: path.trim() })
            },
          }, '更改位置'),
        ),
      )
    }

    module.exports.apply = ctx => {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-autostart-manager', order: 61,
        label: () => '开机自启',
      }, Panel))
    }
    module.exports.inject = ['slots']
    return module.exports
  },
})
