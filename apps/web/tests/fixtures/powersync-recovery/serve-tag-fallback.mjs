// Local-only acceptance harness. Imports the real tag components and Web request client.
// Run: node apps/web/tests/fixtures/powersync-recovery/serve-tag-fallback.mjs [port]
// All API data is synthetic and served by this process; no account or production API is used.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureRoot = path.join(webRoot, 'tests/fixtures/powersync-recovery')
const require = createRequire(path.join(webRoot, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { default: UnoCSS } = await import(require.resolve('unocss/vite'))
const builder = createRequire(require.resolve('nuxt/package.json')).resolve('@nuxt/vite-builder')
const { default: vue } = await import(createRequire(builder).resolve('@vitejs/plugin-vue'))
const port = Number(process.argv[2] || 3212)
const baseline = process.argv.includes('--baseline')
const originalTags = baseline ? execFileSync('git', ['show', 'HEAD:apps/web/app/components/BookmarkTags.vue'], { cwd: webRoot, encoding: 'utf8' }) : null
const catalog = [
  { id: 1, name: 'tech', show_name: 'tech', source: 'mine', added_by: 'user' },
  { id: 3, name: 'design', show_name: 'Friendly design', source: 'mine', added_by: 'user' }
]
let mode = 'success'
let requests = []
let nextId = 10
const server = await createServer({
  root: webRoot,
  configFile: false,
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [path.resolve(webRoot, '../..')] } },
  resolve: {
    alias: [
      { find: '~/components/Toast', replacement: path.join(fixtureRoot, 'toast.ts') },
      { find: '~', replacement: path.join(webRoot, 'app') },
      { find: '@', replacement: path.join(webRoot, 'app') }
    ]
  },
  plugins: [{
    name: 'tag-acceptance-environment',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('?')) return
      if (id.endsWith('/app/components/BookmarkTags.vue')) return (originalTags ?? code).replace('<script lang="ts" setup>', `<script lang="ts" setup>
import { ref, shallowRef, computed, inject, toRef, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn, useResizeObserver } from '@vueuse/core'
import { request } from '~/utils/request'
`)
      if (/\/app\/components\/BookmarkList\/TagChip(?:Detail)?\.vue$/.test(id)) return code.replace('<script lang="ts" setup>', `<script lang="ts" setup>
import { computed } from 'vue'
import { useTagChipInteraction } from '~/composables/useTagChipInteraction'
`)
      if (id.endsWith('/app/utils/request.ts')) return `import { useRuntimeConfig, useAuth, navigateTo, tryUseNuxtApp, useRequestHeaders } from '${path.join(fixtureRoot, 'runtime.ts')}';\n${code}`
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const json = (data, status = 200) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        if (url.pathname === '/') {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml('/', '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/tests/fixtures/powersync-recovery/main.ts"></script></body></html>'))
          return
        }
        if (url.pathname === '/__fixture/control') {
          mode = url.searchParams.get('mode') || 'success'
          if (url.searchParams.has('reset')) requests = []
          return json({ mode, requests })
        }
        if (!url.pathname.startsWith('/v1/')) return next()
        if (url.pathname === '/v1/tag/list') return json({ code: 200, message: 'ok', data: catalog })
        let body = ''
        for await (const chunk of req) body += chunk
        const parsed = JSON.parse(body || '{}')
        requests.push({ path: url.pathname, body: parsed })
        if (mode === 'http-error') return json({ code: 500, message: 'Synthetic request failure', data: 'fixture-error' }, 500)
        if (mode === 'unauthorized') return json({ code: 401, message: 'Synthetic unauthorized', data: '' }, 401)
        if (mode === 'no-result') return json({ code: 200, message: 'ok' })
        if (url.pathname === '/v1/bookmark/del_tag') return json({ code: 200, message: 'ok', data: null })
        if (url.pathname === '/v1/bookmark/add_tags') {
          // SetBookmarkTagsRequest requires name for both existing and new tags.
          // The API resolves the association by raw name, not display alias or id alone.
          if ((!parsed.bookmark_id && !parsed.bookmark_uid) || !Array.isArray(parsed.tags) || !parsed.tags.length || parsed.tags.some(tag => typeof tag.name !== 'string' || !tag.name)) {
            return json({ code: 400, message: 'Tag name is required', data: 'invalid-tag-request' }, 400)
          }
          return json({ code: 200, message: 'ok', data: parsed.tags.map(tag => {
            const existing = catalog.find(item => item.name === tag.name)
            return existing ? { ...existing, show_name: existing.name } : { id: nextId++, name: tag.name, show_name: tag.name, source: 'mine', added_by: 'user' }
          }) })
        }
        return json({ code: 404, message: 'Unknown fixture route' }, 404)
      })
    }
  }, UnoCSS({ configFile: path.join(webRoot, 'uno.config.ts') }), vue()]
})
await server.listen()
console.log(`Tag fallback acceptance fixture: http://127.0.0.1:${port}/?surface=list (also surface=detail or local-only)`)
