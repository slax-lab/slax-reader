import { fileURLToPath } from 'node:url'

// Opt-in layer; synthetic backend bindings never enter the shipped application.
export default defineNuxtConfig({
  vite: {
    server: { hmr: false },
    plugins: [{
      name: 'reader-panel-loading-acceptance',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const path = new URL(request.url || '/', 'http://fixture.invalid').pathname
          const delayed = request.headers.cookie?.split(';').some(cookie => cookie.trim() === 'reader_panel_delay=1')
          if (delayed && /\/components\/Snapshot\/Snapshot(AI|Chat)Panel\.vue$/.test(path)) {
            setTimeout(next, 2500)
          } else {
            next()
          }
        })
      }
    }]
  },
  plugins: [fileURLToPath(new URL('./plugins/seed.client.ts', import.meta.url))],
  nitro: { plugins: [fileURLToPath(new URL('./content-fixture.mjs', import.meta.url))] }
})
