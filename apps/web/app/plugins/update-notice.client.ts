import { useUpdateNotice } from '~/composables/useUpdateNotice'
import type { NuxtAppManifestMeta } from 'nuxt/app'

// A page returning to the foreground re-checks at most this often.
const VISIBILITY_CHECK_INTERVAL_MS = 60_000
// Matches `experimental.checkOutdatedBuildInterval`. Nuxt's own timer stops at the first newer build,
// so this keeps checking for later ones.
const SCHEDULED_CHECK_INTERVAL_MS = 5 * 60_000

const joinURL = (...parts: string[]) =>
  parts.reduce((joined, part) => (joined ? `${joined.replace(/\/+$/, '')}/${part.replace(/^\/+/, '')}` : part), '')

export default defineNuxtPlugin({
  name: 'slax:update-notice',
  setup(nuxtApp) {
    const notice = useUpdateNotice()
    const router = useRouter()
    const config = useRuntimeConfig()

    // A published build only shows the notice. Nuxt's own chunk-reload plugin, which would reload on the
    // next navigation, is disabled with `experimental.emitRouteChunkError: 'manual'`.
    nuxtApp.hook('app:manifest:update', meta => {
      try {
        notice.report('available', meta?.id ?? null)
      } catch {
        // Diagnostics must not affect navigation.
      }
    })

    // Reproduces the part of Nuxt's chunk-reload plugin that stays: a navigation whose chunk failed to
    // load cannot complete, so it reloads to its destination.
    const chunkErrors = new Set<unknown>()
    router.beforeEach(() => {
      chunkErrors.clear()
    })
    nuxtApp.hook('app:chunkError', ({ error }) => {
      chunkErrors.add(error)
      try {
        notice.report('outdated')
      } catch {
        // Diagnostics must not affect navigation.
      }
    })
    router.onError((error, to) => {
      if (chunkErrors.has(error)) reloadNuxtApp({ path: joinURL(config.app.baseURL, to.fullPath), persistState: true })
    })

    if (import.meta.dev || typeof document === 'undefined') return
    let lastCheck = 0
    let scheduled: ReturnType<typeof setTimeout> | undefined
    const check = async (minIntervalMs: number) => {
      const now = Date.now()
      if (now - lastCheck < minIntervalMs) return
      lastCheck = now
      try {
        const [current, latest] = await Promise.all([
          // Like Nuxt's check: a removed manifest for this build means it is no longer current.
          getAppManifest().catch(() => null),
          $fetch<NuxtAppManifestMeta>(`${joinURL(config.app.baseURL, config.app.buildAssetsDir, 'builds/latest.json')}?${now}`)
        ])
        if (typeof latest?.id === 'string' && latest.id !== current?.id) await nuxtApp.hooks.callHook('app:manifest:update', latest)
      } catch {
        // A failed check is retried on the next visibility change or scheduled check.
      }
    }
    const schedule = () => {
      if (scheduled) clearTimeout(scheduled)
      scheduled = setTimeout(() => {
        if (document.visibilityState === 'visible') void check(VISIBILITY_CHECK_INTERVAL_MS)
        schedule()
      }, SCHEDULED_CHECK_INTERVAL_MS)
    }
    nuxtApp.hook('app:manifest:update', () => {
      if (!scheduled) schedule()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void check(VISIBILITY_CHECK_INTERVAL_MS)
    })
  }
})
