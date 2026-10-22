import { isNavigationFailure } from 'vue-router'
import { getUserToken } from '~/utils/request'

export default defineNuxtPlugin({
  name: 'slax:powersync-public-restore',
  dependsOn: ['slax:powersync'],
  setup(nuxtApp) {
    const router = useRouter()
    const bypassed = nuxtApp.$powersyncPublicBypass
    let pending: symbol | null = null
    let disposed = false

    const navigate = async (fullPath: string): Promise<false> => {
      if (!bypassed || disposed || pending) return false
      const activation = Symbol('public-document-navigation')
      pending = activation
      try {
        const destination = router.resolve(fullPath).fullPath
        // Only router-resolved internal destinations belong to this guard.
        if (!/^\/(?![\\/])/.test(destination)) {
          pending = null
          return false
        }
        const outcome = await nuxtApp.runWithContext(() => navigateTo(destination, { external: true }))
        // Nuxt's external navigation returns false to stop the old SPA route.
        // A Vue Router failure instead means no transition was dispatched.
        if (isNavigationFailure(outcome) && pending === activation) pending = null
      } catch {
        if (pending === activation) pending = null
      }
      // Both the first request and duplicates must prevent destination mounting.
      return false
    }

    if (bypassed) {
      const onPageShow = (event: PageTransitionEvent) => {
        if (!event.persisted || disposed) return
        try {
          if (!nuxtApp.runWithContext(() => getUserToken())) return
        } catch {
          // Unreadable state re-enters normal startup, never anonymous bypass.
        }
        void navigate(router.currentRoute.value.fullPath)
      }
      const onPageHide = () => { pending = null }
      const dispose = () => {
        disposed = true
        pending = null
        window.removeEventListener('pageshow', onPageShow)
        window.removeEventListener('pagehide', onPageHide)
      }
      window.addEventListener('pageshow', onPageShow)
      window.addEventListener('pagehide', onPageHide)
      // Do not bind cleanup to Nuxt's effect scope: external navigateTo stops
      // that scope before a document can be frozen into BFCache.
      nuxtApp.vueApp.onUnmount(dispose)
      if (import.meta.hot) import.meta.hot.dispose(dispose)
    }
    return { provide: { powersyncPublicNavigate: navigate } }
  }
})
