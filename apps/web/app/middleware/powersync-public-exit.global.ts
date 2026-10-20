import { needsPublicDocumentExit } from '~/local-first/public-startup-policy'

export default defineNuxtRouteMiddleware(to => {
  if (import.meta.server) return
  const app = useNuxtApp()
  if (!needsPublicDocumentExit(app.$powersyncPublicBypass, to.path)) return
  return app.$powersyncPublicNavigate(to.fullPath)
})
