export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const { pathname } = getRequestURL(event)
    const isLogin = pathname === '/login' || pathname === '/login/'
    if (pathname !== '/' && !isLogin) return

    const { app, loginAssetPreloads, loginLocalePreloads } = useRuntimeConfig(event)
    const cdnURL = app.cdnURL.replace(/\/$/, '')
    for (const path of loginLocalePreloads) {
      html.head.push(`<link rel="preload" as="fetch" crossorigin="anonymous" fetchpriority="low" href="${encodeURI(cdnURL + path)}">`)
    }
    if (!isLogin) return

    // The SPA renderer emits generic prefetch links for unrelated routes.
    for (const [index, fragment] of html.head.entries()) {
      html.head[index] = fragment.replace(/<link rel="prefetch"[^>]*>/g, '')
    }

    const assetsURL = (cdnURL || app.baseURL.replace(/\/$/, '')) + app.buildAssetsDir
    for (const file of loginAssetPreloads) {
      const href = encodeURI(assetsURL + file)
      const hint = file.endsWith('.css') ? 'rel="preload" as="style"' : 'rel="modulepreload"'
      html.head.push(`<link ${hint} crossorigin="anonymous" href="${href}">`)
    }
  })
})
