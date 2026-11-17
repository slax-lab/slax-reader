import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

// Seed only a disposable browser context's real local PowerSync database.
export default defineNuxtPlugin({
  name: 'reader-regression-fixture',
  dependsOn: ['slax:powersync'],
  async setup(app) {
    const url = new URL(location.href)
    const startupDelay = Number(url.searchParams.get('startupDelay') || 0)
    if (startupDelay) await new Promise(resolve => setTimeout(resolve, startupDelay))
    const db = app.$powersync
    if (db && url.searchParams.get('local') === '1') {
      const uuid = url.pathname.split('/').pop()!
      await db.execute('INSERT OR REPLACE INTO sr_user_bookmark (id, user_id, archive_status, is_starred, created_at, updated_at, type, metadata) VALUES (?, ?, 0, 0, ?, ?, 0, ?)', [uuid, '1', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z', '{}'])
      await db.execute('INSERT OR REPLACE INTO ps_data_local__local_reading_state (id, data) VALUES (?, ?)', [uuid, JSON.stringify({ anchor_index: 14, anchor_ratio: 0, percent: 0.15, updated_at: '2026-11-17T00:00:00Z' })])
      if (uuid.includes('marked')) {
        // Simulate the stream checkpoint only; SQL reads, writes and watchers remain real.
        const waitForStatus = db.waitForStatus.bind(db)
        db.waitForStatus = (predicate, signal) => {
          const status = Object.create(db.currentStatus)
          status.forStream = () => ({ subscription: { hasSynced: true } })
          return waitForStatus(predicate(status) ? () => true : predicate, signal)
        }
        window.setTimeout(async () => {
          await db.execute("INSERT OR REPLACE INTO sr_user (id, name) VALUES ('1', 'Synthetic reader')")
          for (const reply of [false, true]) {
            await db.execute('INSERT OR REPLACE INTO sr_bookmark_comment (id, type, source, user_bookmark_uuid, comment, is_deleted, created_at, metadata) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', [reply ? 'reader-reply' : 'reader-mark', reply ? 3 : 2, JSON.stringify(reply ? [] : [{ type: 'text', path: '#passage-40', start: 0, end: 10 }]), uuid, reply ? 'Synthetic reply' : 'Synthetic comment on Passage 40', '2026-11-17T00:00:00Z', JSON.stringify({ user_id: '1', root_id: reply ? 'reader-mark' : null, parent_id: reply ? 'reader-mark' : null })])
          }
        }, 1500)
      }
      const original = db.getOptional.bind(db)
      db.getOptional = async (query, parameters) => {
        const delay = query.includes('local_reading_state') ? Number(url.searchParams.get('positionDelay') || 0) : query.includes('SELECT id FROM sr_user_bookmark') ? Number(url.searchParams.get('readyDelay') || 0) : 0
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        return original(query, parameters)
      }
    }
    const user = useUserStore()
    const account = useAccountContext()
    Object.assign(window, { readerFixture: { router: app.$router, db, user, account } })
    onNuxtReady(() => {
      document.documentElement.dataset.readerMounted = 'true'
      if (url.searchParams.get('manual') !== '1') return
      const controls = document.createElement('nav')
      controls.id = 'reader-fixture-controls'
      controls.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:999;display:flex;gap:8px;padding:8px;background:var(--slax-surface-solid);border:1px solid var(--slax-border);font:12px system-ui'
      for (const [label, path] of [['Article A', '/b/reader-one'], ['Article B', '/b/reader-two']]) {
        const button = document.createElement('button')
        button.textContent = label!
        button.onclick = () => { void app.$router.push(path!) }
        controls.append(button)
      }
      document.body.append(controls)
    })
  }
})
