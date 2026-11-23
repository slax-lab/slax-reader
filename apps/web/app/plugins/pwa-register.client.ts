import { useUpdateNotice } from '~/composables/useUpdateNotice'
import type { NuxtAppManifestMeta } from 'nuxt/app'
import { registerSW } from 'virtual:pwa-register'

// Registers the PWA Service Worker in place of @vite-pwa/nuxt's client plugin (`pwa.client.registerPlugin:
// false`). In `autoUpdate` mode vite-plugin-pwa reloads the page when a new worker activates unless
// `onNeedReload` is given; here that shows the new-version notice instead. The worker still installs,
// skips waiting, and claims open pages, so later requests use the new build.
export default defineNuxtPlugin({
  name: 'slax:pwa-register',
  setup() {
    const standaloneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null
    const isStandalone = () => !!standaloneQuery?.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    // `pwaOpen` reads only `isPWAInstalled`, which once true stays true for the page.
    const pwa = reactive({ isPWAInstalled: isStandalone() })
    standaloneQuery?.addEventListener?.('change', event => {
      if (event.matches) pwa.isPWAInstalled = true
    })

    if ('serviceWorker' in navigator) {
      try {
        // Resolved now: `onNeedReload` runs later, outside the Nuxt context.
        const notice = useUpdateNotice()
        const { app } = useRuntimeConfig()
        const latestBuildURL = `${app.baseURL.replace(/\/+$/, '')}/${app.buildAssetsDir.replace(/^\/+|\/+$/g, '')}/builds/latest.json`
        // The notice is keyed by build id, so a notice closed here stays closed when Nuxt's own check
        // later finds the same build.
        const reportNewBuild = async () => {
          let buildId: string | null = null
          try {
            buildId = (await $fetch<NuxtAppManifestMeta>(`${latestBuildURL}?${Date.now()}`))?.id ?? null
          } catch {
            // Without the id, the notice still shows.
          }
          notice.report('available', typeof buildId === 'string' ? buildId : null)
        }
        registerSW({
          immediate: true,
          onNeedReload() {
            reportNewBuild().catch(() => {
              // The notice is advisory; the new worker is already in control.
            })
          },
          onRegisterError() {
            // Registration failure only removes offline assets and installability.
          }
        })
      } catch {
        // As above.
      }
    }

    return { provide: { pwa } }
  }
})
