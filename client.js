// Product settings; platform details and editable launch paths stay collapsed.
window.__ModuleLoader__.load({
  id: 'dsh-autostart-manager',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React
    const module = { exports: {} }
    async function call(endpoint, payload) {
      const response = await fetch('api/dsh-autostart-manager', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload: payload ?? {} }),
      })
      if (!response.ok) throw new Error('暂时无法连接，请稍后重试。')
      const result = await response.json()
      if (!result.ok) throw new Error(result.error?.message || '操作失败，请重试。')
      return result.value
    }
    const S = {
      card: { border: '1px solid var(--bt-line-2, #ddd)', borderRadius: 10, padding: 16, color: 'var(--bt-ink, #141414)', background: 'var(--bt-card, #fff)', fontSize: 13, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' },
      muted: { color: 'var(--bt-ink-2, #666)', fontSize: 12 },
      input: { boxSizing: 'border-box', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid var(--bt-line-2, #ccc)', borderRadius: 6, background: 'var(--bt-card, #fff)', color: 'inherit', fontSize: 12 },
      btn: { padding: '5px 12px', border: '1px solid var(--bt-line-2, #ccc)', borderRadius: 6, cursor: 'pointer', background: 'var(--bt-card, #fff)', color: 'inherit' },
      error: { color: 'var(--bt-danger, #d22)', marginTop: 8, fontSize: 12 },
    }
    const draftOf = state => ({ target: state.target, mode: state.mode, exe: state.exe || '', web: { ...state.web, argsText: JSON.stringify(state.web?.args || []) } })
    function Panel() {
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [dirty, setDirty] = useState(false)
      const dirtyRef = useRef(false)
      const refresh = useCallback(async () => {
        try {
          const value = await call('state')
          setState(value)
          if (!dirtyRef.current) setDraft(draftOf(value))
        } catch { setError('暂时无法读取设置，请稍后重试。') }
      }, [])
      useEffect(() => { refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer) }, [refresh])
      const change = (key, value, web = false) => {
        setDraft(old => web ? { ...old, web: { ...old.web, [key]: value } } : { ...old, [key]: value })
        dirtyRef.current = true; setDirty(true); setError('')
      }
      const payload = () => ({
        target: draft.target, mode: state.platform === 'linux' && draft.target === 'desktop' ? 'show' : draft.mode,
        exe: draft.exe.trim(), web: { ...draft.web, args: draft.target === 'web' ? JSON.parse(draft.web.argsText) : state.web.args, argsText: undefined },
      })
      const act = async (endpoint, data) => {
        setBusy(true); setError('')
        try {
          if (dirtyRef.current && endpoint !== 'disable') await call('configure', payload())
          if (endpoint !== 'configure') await call(endpoint, data)
          dirtyRef.current = false; setDirty(false)
          await refresh()
        } catch (error) { setError(error instanceof SyntaxError ? '启动参数请填写 JSON 字符串数组。' : error.message) }
        finally { setBusy(false) }
      }
      const toggle = (label, checked, disabled, onChange) => h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: Boolean(checked), disabled, onChange, style: { width: 18, height: 18, accentColor: 'var(--bt-accent, #4d6bfe)' } })
      const field = (label, key, web = false, placeholder = '') => h('label', { style: { display: 'block', marginTop: 10 } }, label,
        h('input', { style: S.input, value: (web ? draft.web[key] : draft[key]) ?? '', disabled: busy, placeholder, onChange: event => change(key, event.target.value, web) }))
      if (!state || !draft) return h('div', { style: S.card }, error || '加载中…')
      if (!state.supported) return h('div', { style: S.card }, '当前系统暂不支持开机自启。')
      if (!state.target) return h('div', { style: S.card }, '新版本已就绪，请重启客户端以加载。')
      const web = draft.target === 'web'
      const silentSupported = web || state.platform !== 'linux'
      return h('div', { style: S.card },
        h('label', { style: S.row }, '启动方式', h('select', { value: draft.target, disabled: busy, style: { ...S.input, width: 'auto', margin: 0 }, onChange: event => change('target', event.target.value) },
          h('option', { value: 'desktop' }, '桌面客户端'), h('option', { value: 'web' }, 'Web 服务'))),
        h('label', { style: S.row }, h('div', null, '开机自启', h('div', { style: S.muted }, '登录设备后自动启动 DeepSeek Harness')),
          toggle('开机自启', state.enabled, busy, event => act(event.target.checked ? 'enable' : 'disable'))),
        silentSupported ? h('label', { style: S.row }, web ? '自启时打开浏览器' : '自启时显示主窗口',
          toggle(web ? '自启时打开浏览器' : '自启时显示主窗口', draft.mode === 'show', busy,
            event => { change('mode', event.target.checked ? 'show' : 'silent') })) : null,
        state.systemDisabled ? h('div', { style: S.muted }, '已在系统启动设置中关闭。') : null,
        !web && draft.mode === 'silent' && state.platform === 'win32' ? h('div', { style: S.muted }, '启动后收起到托盘，窗口可能短暂出现。') : null,
        web ? h('div', { style: S.muted }, '修改的是运行 DSH 的这台设备。') : null,
        !dirty && !state.valid ? h('div', { style: S.error }, state.problem) : null,
        state.registered && !state.bootstrapMatches && !state.systemDisabled ? h('div', { style: S.error }, '启动设置需要更新。 ', h('button', { style: S.btn, disabled: busy, onClick: () => act('enable') }, '修复')) : null,
        h('details', { style: { marginTop: 16 }, open: dirty && draft.target !== state.target ? true : undefined },
          h('summary', { style: { ...S.muted, cursor: 'pointer' } }, '高级设置'),
          web ? h('div', null,
            field('启动程序', 'executable', true),
            field('启动参数（JSON 数组）', 'argsText', true, '["/path/to/dsh-cli.js", "--profile", "web", "--port", "8080"]'),
            field('工作目录', 'cwd', true), field('本机访问地址', 'url', true, 'http://127.0.0.1:8080/'), field('Node.js 路径', 'runtime', true),
          ) : field(state.platform === 'darwin' ? '客户端位置（.app）' : '客户端位置', 'exe'),
          h('div', { style: { ...S.muted, marginTop: 10 } }, '修改后在下次登录时生效。'),
        ),
        dirty ? h('div', { style: { marginTop: 12 } },
          h('button', { style: S.btn, disabled: busy, onClick: () => act('configure') }, busy ? '保存中…' : '保存设置'),
          h('button', { style: { ...S.btn, marginLeft: 8 }, disabled: busy, onClick: () => { dirtyRef.current = false; setDirty(false); setDraft(draftOf(state)); setError('') } }, '取消'),
        ) : null,
        error ? h('div', { style: S.error, role: 'alert' }, error) : null,
      )
    }
    module.exports.apply = ctx => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-autostart-manager', order: 61, label: () => '开机自启' }, Panel))
    module.exports.inject = ['slots']
    return module.exports
  },
})
