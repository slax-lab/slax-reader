import { eventLog } from '@/utils/analytics'

import type { NuxtApp } from '#app'
import type { NavigationFailure, RouteLocationNormalized } from 'vue-router'

type ScreenName = 'signup' | 'bookmarks' | 'welcome' | 'signup_done' | 'detail' | 'extension_save'
type ListMode = 'inbox' | 'starred' | 'archive'

const screenPropertiesForRoute = (path: string, query: Record<string, unknown>): { screen_name: ScreenName; list_mode?: ListMode } | undefined => {
  if (path === '/login' || path === '/auth') return { screen_name: 'signup' }
  if (path === '/' || path === '/bookmarks') {
    const filter = Array.isArray(query.filter) ? query.filter[0] : query.filter
    const listMode: ListMode = filter === 'starred' || filter === 'archive' ? filter : 'inbox'
    return { screen_name: 'bookmarks', list_mode: listMode }
  }
  if (/^\/b\/[^/]+\/?$/.test(path) || /^\/bookmarks\/[^/]+\/?$/.test(path)) return { screen_name: 'detail' }
  if (path === '/onboarding' || (path === '/guide' && query.from === 'extension')) return { screen_name: 'welcome' }
  return undefined
}

export default defineNuxtPlugin((nuxtApp: NuxtApp): void => {
  const router = useRouter()
  const error = useError()
  let lastScreenKey = ''
  let mounted = false

  const trackScreen = (path: string, query: Record<string, unknown>) => {
    const properties = screenPropertiesForRoute(path, query)
    if (!properties || error.value) return

    const key = `${path}:${properties.screen_name}:${properties.list_mode ?? ''}`
    if (key === lastScreenKey) return
    lastScreenKey = key
    eventLog({ event_name: 'screen_viewed', properties })
  }

  router.afterEach((to: RouteLocationNormalized, _from: RouteLocationNormalized, failure?: NavigationFailure | void) => {
    if (!mounted || failure) return
    // Route resolution precedes async detail loading. Wait for the rendered page before
    // counting a detail view, otherwise a missing bookmark is counted as a successful view.
    if (screenPropertiesForRoute(to.path, to.query as Record<string, unknown>)?.screen_name === 'detail') return
    trackScreen(to.path, to.query as Record<string, unknown>)
  })

  nuxtApp.hook('page:finish', () => {
    if (!mounted) return
    const route = router.currentRoute.value
    trackScreen(route.path, route.query as Record<string, unknown>)
  })

  nuxtApp.hook('app:error', () => { lastScreenKey = '' })

  const onClick = (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return
    const target = event.target
    if (!(target instanceof Element)) return

    const element = target.closest<HTMLElement>('[data-analytics-element]')
    const elementId = element?.dataset.analyticsElement
    if (!elementId) return

    const route = router.currentRoute.value
    const screen = screenPropertiesForRoute(route.path, route.query as Record<string, unknown>)
    if (!screen || error.value) return
    if ((elementId === 'login_google_button' || elementId === 'login_apple_button') && screen.screen_name !== 'signup') return

    eventLog({
      event_name: 'element_clicked',
      properties: {
        element_id: elementId,
        screen_name: screen.screen_name
      }
    })
  }

  nuxtApp.hook('app:mounted', () => {
    mounted = true
    const route = router.currentRoute.value
    trackScreen(route.path, route.query as Record<string, unknown>)
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
  })
})
