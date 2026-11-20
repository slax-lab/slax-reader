import type { PowerSyncDatabase } from '@powersync/web'

const VISIBLE_SETTLE_MS = 500

/**
 * Holds live-query work while this page is hidden and releases it when the page becomes visible.
 *
 * Every tab shares one SharedWorker connection, and a query holds it across several page-to-worker round trips.
 * Chrome deprioritizes hidden renderers, so a hidden tab's query can hold the connection for seconds or minutes
 * and every other tab's initialization queues behind it. Initial runs are held too: a page opened in a background
 * tab loads its live data when it is first shown.
 */
export function deferLiveQueriesWhileHidden(database: PowerSyncDatabase, doc: Pick<Document, 'visibilityState' | 'addEventListener'> = document) {
  let resume: Promise<void> | null = null
  let release: (() => void) | null = null
  let settle: ReturnType<typeof setTimeout> | undefined
  const update = () => {
    clearTimeout(settle)
    if (doc.visibilityState === 'hidden') {
      resume ??= new Promise<void>(resolve => (release = resolve))
      return
    }
    // Closing a tab briefly activates its neighbour; release only once this page stays visible.
    settle = setTimeout(() => {
      const resolve = release
      resume = release = null
      resolve?.()
    }, VISIBLE_SETTLE_MS)
  }
  update()
  doc.addEventListener('visibilitychange', update)

  // Watched queries resolve their tables with EXPLAIN reads before registering for changes.
  const resolveTables = database.resolveTables.bind(database)
  database.resolveTables = async (...args) => {
    if (resume) await resume
    return resolveTables(...args)
  }

  const register = database.onChangeWithCallback.bind(database)
  database.onChangeWithCallback = (handler, options) => {
    if (!handler?.onChange) return register(handler, options)
    const { onChange } = handler
    return register(
      {
        ...handler,
        onChange: async event => {
          if (resume) await resume
          return onChange(event)
        }
      },
      options
    )
  }
}
