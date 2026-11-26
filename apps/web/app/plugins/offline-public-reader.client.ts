import { readerPath } from '~/offline/public-reader'
import { savePublicReader } from '~/offline/save-public-reader'

export default defineNuxtPlugin(nuxtApp => {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return
  const router = useRouter()
  const locale = nuxtApp.$i18n.locale
  const refresh = () => {
    const path = router.currentRoute.value.path
    if (!readerPath.test(path)) return
    const theme = document.documentElement.dataset.slaxTheme
    const appearance = {
      locale: locale.value === 'zh' ? 'zh' : 'en',
      theme: theme === 'dark' || theme === 'eink' ? theme : 'light'
    } as const
    const code = document.cookie.match(/(?:^|;\s*)slax-share-entry=([a-zA-Z0-9_-]+)/)?.[1]
    void savePublicReader(path, appearance, code).catch(() => {
      // Offline, blocked storage and transient failures leave the online reader usable.
    })
  }
  nuxtApp.hook('page:finish', refresh)
})
