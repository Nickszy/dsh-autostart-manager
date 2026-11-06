import { createManager, version } from './core.mjs'
export const name = 'dsh-autostart-manager'
export { version }
export const inject = ['connection']
export function apply(ctx) {
  const manager = createManager()
  // Refresh login assets after an upgrade; never re-enable a disabled startup item.
  try { manager.installAssets() } catch {}
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dsh-autostart-manager', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      let result
      try {
        const { endpoint, payload = {} } = await request.json()
        let value
        switch (endpoint) {
          case 'state': value = manager.state(); break
          case 'enable': value = manager.enable(payload ?? {}); break
          case 'disable': value = manager.disable(); break
          case 'configure': value = manager.update(payload ?? {}); break
          case 'setmode': value = manager.update({ mode: payload?.mode }); break
          case 'set-exe': value = manager.update({ exe: payload?.exe }); break
          case 'launch-now': value = await manager.launch(); break
          default: throw new Error('不支持的操作。')
        }
        result = { ok: true, value }
      } catch (error) {
        // OS diagnostic output stays out of the product UI.
        const message = error.code === 'autostart/registry' ? '无法更新系统启动设置，请稍后重试。' : String(error.message || '操作失败，请重试。')
        result = { ok: false, error: { code: 'autostart/operation', message } }
      }
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
    },
  }), 'autostart-manager: management api')
}
