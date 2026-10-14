export default defineNuxtPlugin({
  name: 'ext-bridge-client',
  enforce: 'pre',
  setup() {
    if (typeof window === 'undefined') return
    if (window.location.pathname !== '/x/ext-bridge') return

    const hash = window.location.hash
    if (!hash) return

    const params = new URLSearchParams(hash.slice(1))
    const clientId = params.get('c')
    if (!clientId) return

    try {
      window.sessionStorage.setItem('slax:ext-bridge-client-id', clientId)

      history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      if (window.parent !== window) window.parent.postMessage({ type: 'slax-bridge-error', error: 'bridge storage unavailable' }, '*')
    }
  }
})
