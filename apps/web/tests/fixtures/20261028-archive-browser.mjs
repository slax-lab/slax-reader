// Exercise production list, reader action, and channel code in two browser tabs.
// The HTTP server supplies synthetic bookmarks. No account or production API is used.
// Run from the repository root: node apps/web/tests/fixtures/20261028-archive-browser.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(resolve(web, 'package.json'))
const testRequire = createRequire(require.resolve('@nuxt/test-utils'))
const { build } = testRequire('esbuild')
const { chromium } = testRequire('playwright-core')
const source = readFileSync(resolve(web, 'app/pages/b/[id].vue'), 'utf8')
const archiveAction = source.slice(source.indexOf('const archiveBookmark = async'), source.indexOf('const starBookmark = async'))
const globals = `
import { ref } from 'vue';
export { addChannelMessageHandler, removeChannelMessageHandler, postChannelMessage } from '${resolve(web, 'app/utils/channel.ts')}';
export const getUserToken = () => 'x.' + btoa(JSON.stringify({id: sessionStorage.getItem('account') || 'account-a'})) + '.x';
export const haveRequestToken = () => true;
export const useNuxtApp = () => ({ $powersync: null });
export const useState = (_key, init) => ref(init());
export const useI18n = () => ({ t: key => key, locale: ref('en') });
export const isLocalFirstEnabled = () => false;
export const isHighlightLocalFirstEnabled = () => false;
export const request = () => ({
  get: async ({query}) => { const response = await fetch('/items?' + new URLSearchParams(query)); if (!response.ok) throw Error('list failed'); return response.json(); },
  post: async ({body}) => { const response = await fetch('/archive', {method:'POST', body:JSON.stringify(body)}); if (!response.ok) throw Error('archive failed'); return response.json(); }
});
`
const client = `
import { createApp, defineComponent, h, ref } from 'vue';
import { useBookmarkData } from './app/composables/bookmark/useBookmarkData.ts';
import { deriveAccountKey } from './app/utils/accountContext.ts';
import { RESTMethodPath } from '@slax-reader/contracts/const';
const filter = { filterStatus:ref('inbox'), filterTopicIds:ref([]), filterCollectionId:ref(0) };
let api;
if (location.pathname === '/reader') {
  const uuid = 'uuid-1', bookmarkUid = ref(uuid), localFirst = ref(false), local = null;
  const isArchived = ref(new URLSearchParams(location.search).has('archived'));
  const restArchived = ref(isArchived.value ? 'archive' : 'inbox'), accountGeneration = ref(0);
  const t = key => key, ToastType = {Error:'error'};
  const Toast = {showToast: () => { document.body.dataset.failed = 'true'; }};
  const showSuccessToast = () => { document.body.dataset.saved = 'true'; };
  ${archiveAction}
  createApp({render:()=>h('button', {onClick:()=>archiveBookmark(null)}, isArchived.value ? 'Unarchive' : 'Archive')}).mount('#app');
} else {
  createApp(defineComponent({setup() {
    api = useBookmarkData(filter, ref(''));
    return ()=>h('main', [h('button', {onClick:()=>api.onLoadMore()}, 'Load more'), ...api.bookmarks.value.map(item=>h('p', {key:item.id, 'data-id':item.id, style:'height:40px'}, item.title))]);
  }})).mount('#app');
  window.fixture = {api, filter};
}
`
const bundle = await build({
  stdin: { contents: client, loader: 'ts', resolveDir: web, sourcefile: 'archive-browser.ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
  alias: { '~': resolve(web, 'app'), '@': resolve(web, 'app') },
  define: { 'import.meta.client': 'true', 'import.meta.server': 'false', 'process.env.NODE_ENV': '"test"' },
  inject: ['/fixture-globals.ts'],
  plugins: [{ name: 'fixture-globals', setup(plugin) {
    plugin.onResolve({filter: /^\/fixture-globals.ts$/}, args => ({ path: args.path, namespace: 'fixture' }))
    plugin.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({ contents: globals, loader: 'ts', resolveDir: web }))
    plugin.onResolve({filter: /composables\/bookmark\/useLocal(Bookmarks|Collections|Marks)$/}, args => ({ path: args.path.split('/').pop(), namespace: 'unused-local' }))
    plugin.onLoad({filter: /.*/, namespace: 'unused-local'}, args => ({ contents: `export function ${args.path}() { throw Error('Local data is outside this REST fixture'); }`, loader: 'ts' }))
  }}]
})
const records = Array.from({length:60}, (_,index) => ({
  id:index+1, bookmark_user_uuid:`uuid-${index+1}`, title:`Article ${index+1}`, archived:'inbox', starred:'unstar',
  created_at:'2026-10-28T00:00:00Z', updated_at:'2026-10-28T00:00:00Z', host_url:'example.test', tags:[]
}))
let failList = false
let reads = 0
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/client.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].text); return }
  if (url.pathname === '/items') {
    reads++
    if (failList) { res.writeHead(503).end(); return }
    const page = Number(url.searchParams.get('page')) || 1
    const rows = records.filter(item => item.archived === (url.searchParams.get('filter') || 'inbox'))
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(rows.slice((page-1)*20,page*20))); return
  }
  if (url.pathname === '/archive') {
    let body = ''; for await (const part of req) body += part
    const change = JSON.parse(body)
    records.find(item => item.bookmark_user_uuid === change.bookmark_uid).archived = change.status
    res.setHeader('Content-Type','application/json'); res.end('{}'); return
  }
  res.setHeader('Content-Type','text/html')
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Archive regression fixture</title><body><div id="app"></div><script type="module" src="/client.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({channel:'chrome', headless:true})
  const context = await browser.newContext({viewport:{width:1000,height:700}})
  context.setDefaultTimeout(10_000)
  const home = await context.newPage()
  const errors = []
  home.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  home.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  await home.goto(origin)
  await home.waitForSelector('[data-id="1"]')
  await home.getByRole('button',{name:'Load more'}).click()
  await home.waitForSelector('[data-id="40"]')
  await home.evaluate(() => scrollTo(0,450))
  const beforeScroll = await home.evaluate(() => scrollY)
  const beforeAnchor = await home.locator('[data-id="10"]').evaluate(element => element.getBoundingClientRect().top)
  const reader = await context.newPage()
  await reader.goto(`${origin}/reader`)
  await reader.getByRole('button',{name:'Archive',exact:true}).click()
  await reader.waitForFunction(() => document.body.dataset.saved === 'true')
  await reader.close()
  await home.bringToFront()
  await home.waitForFunction(() => !document.querySelector('[data-id="1"]') && document.querySelector('[data-id="41"]'))
  assert.equal(await home.locator('[data-id]').count(),40)
  assert.equal(await home.locator('[data-id="10"]').evaluate(element => element.getBoundingClientRect().top),beforeAnchor)
  assert.ok(await home.evaluate(() => scrollY) > 0)
  console.log('PASS: archive, loaded pages, and visible scroll anchor')

  const restore = await context.newPage()
  await restore.goto(`${origin}/reader?archived=1`)
  await restore.getByRole('button',{name:'Unarchive'}).click()
  await restore.waitForFunction(() => document.body.dataset.saved === 'true')
  await restore.close()
  await home.bringToFront()
  await home.waitForSelector('[data-id="1"]')
  console.log('PASS: unarchive')

  // Change server state without a message, then exercise real tab visibility events.
  const other = await context.newPage()
  await other.goto(`${origin}/reader`)
  await other.bringToFront()
  records[0].archived = 'archive'
  await other.close()
  await home.bringToFront()
  // Headless Chrome can keep every tab visible. Dispatch the return event explicitly.
  await home.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await home.waitForFunction(() => !document.querySelector('[data-id="1"]'))
  console.log('PASS: missed notification')
  failList = true
  const count = await home.locator('[data-id]').count()
  const requestsBeforeFailure = reads
  await home.evaluate(() => window.dispatchEvent(new Event('focus')))
  await home.waitForTimeout(350)
  assert.ok(reads > requestsBeforeFailure)
  assert.equal(await home.locator('[data-id]').count(),count)
  failList = false
  records[0].archived = 'inbox'
  await home.evaluate(() => window.dispatchEvent(new Event('focus')))
  await home.waitForSelector('[data-id="1"]')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ result:'PASS', browser:await browser.version(), archive:true, unarchive:true, missedMessage:true, failureRecovery:true, loadedRows:count, scrollBefore:beforeScroll, scrollAfter:await home.evaluate(()=>scrollY), pageErrors:errors }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
