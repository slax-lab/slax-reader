// Real Chrome content scripts + MV3 worker + HTTP API. Uses a disposable profile and synthetic account.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const extensionDir = path.resolve(import.meta.dirname, '..')
// Build only from explicit synthetic configuration, never local environment files.
for (const directory of [extensionDir, path.resolve(extensionDir, '../../deploy/local')]) {
  const files = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (files.some(name => /^\.(env|dev\.vars)(\.|$)/.test(name) && !name.endsWith('.example'))) {
    throw new Error('Run the locale fixture in an isolated worktree without local environment files')
  }
}
const pkg = JSON.parse(await readFile(path.join(extensionDir, 'package.json'), 'utf8'))
const buildDir = path.join(extensionDir, 'build/locale-e2e/chrome-mv3')
const key = 'slax:account-locale:v1'
const jwt = (id, seq = 1) => `x.${Buffer.from(JSON.stringify({ id, seq })).toString('base64url')}.x`
let account = 'A',
  lang = 'zh',
  meCalls = 0,
  failMe = false
const heldCollections = []
const chatStreams = []
const toolEvent = (name, status, content) => `data: ${JSON.stringify({ choices: [{ status, delta: [{ role: 'tool', name, content }] }] })}\n\n`
const bookmark = {
  uuid: 'bookmark-1',
  title: 'Test article',
  alias_title: '',
  url: 'https://test.invalid/article',
  host_url: 'test.invalid',
  site_name: 'Test',
  content_icon: '',
  content_cover: '',
  content_word_count: 10,
  description: '',
  byline: '',
  status: 'success',
  published_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  archived: 'inbox',
  starred: 'unstar',
  tags: [],
  overview: '',
  key_takeaways: [],
  marks: { mark_list: [], user_list: {} }
}
const user = () => ({ userId: account, email: `${account}@test.invalid`, name: 'Test User', lang, subscription_end_at: '2099-01-01T00:00:00Z', subscription_type: 2 })
const bridge = `<!doctype html><script>
parent.postMessage({ type: 'slax-bridge-ready' }, '*');
addEventListener('message', async event => {
  if (typeof event.data?.id !== 'number') return;
  const user = await fetch('/bridge-user').then(r => r.json());
  const result = event.data.method === 'userInfo' ? user : { state: 'local', userKey: user.userId, hasSynced: false, hasLocalData: true, bookmark: ${JSON.stringify(bookmark)} };
  parent.postMessage({ id: event.data.id, result }, '*');
});
</script>`
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') {
    res.end()
    return
  }
  const url = new URL(req.url, 'http://127.0.0.1')
  const json = value => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(value))
  }
  if (url.pathname === '/v1/user/me') {
    ++meCalls
    json(failMe ? { code: 503, message: 'unavailable', data: null } : { code: 200, message: 'ok', data: user() })
    return
  }
  if (url.pathname === '/bridge-user') {
    json(user())
    return
  }
  if (url.pathname === '/x/ext-bridge') {
    res.setHeader('Content-Type', 'text/html')
    res.end(bridge)
    return
  }
  if (url.pathname === '/v1/aigc/chat') {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(toolEvent('search', 'processing', 'locale query'))
    chatStreams.push(res)
    return
  }
  if (url.pathname === '/v1/bookmark/add') {
    heldCollections.push(res)
    return
  }
  if (url.pathname === '/v1/share/exists' || url.pathname === '/v1/share/update') {
    json({ code: 200, message: 'ok', data: { show_comment_line: false, show_userinfo: true, code: 'test-share' } })
    return
  }
  if (url.pathname.startsWith('/v1/') || url.pathname === '/events') {
    json({ code: 200, message: 'ok', data: [] })
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    '<!doctype html><title>Locale browser test</title><main><p id="selection-target">Local test article for comment selection.</p><textarea id="draft">unsaved article note</textarea></main>'
  )
})
const delay = ms => new Promise(r => setTimeout(r, ms))
const until = async (read, check, label, timeout = 10000) => {
  const end = Date.now() + timeout
  let value
  do {
    value = await read()
    if (check(value)) return value
    await delay(75)
  } while (Date.now() < end)
  throw new Error(`${label}: ${JSON.stringify(value)}`)
}
let context, profile
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  execFileSync(path.join(extensionDir, 'node_modules/.bin/wxt'), ['build', '-c', 'tests/wxt.locale-test.config.mjs'], {
    cwd: extensionDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: '1',
      SLAX_ENV: 'development',
      PUBLIC_BASE_URL: origin,
      AUTH_BASE_URL: origin,
      SHARE_BASE_URL: 'https://share.invalid',
      EXTENSIONS_API_BASE_URL: origin,
      COOKIE_DOMAIN: '127.0.0.1',
      COOKIE_TOKEN_NAME: 'slax-locale-test',
      UNINSTALL_FEEDBACK_URL: `${origin}/uninstall`
    }
  })
  const manifest = JSON.parse(await readFile(path.join(buildDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.manifest_version, 3)
  profile = await mkdtemp(path.join(os.tmpdir(), 'slax-locale-e2e-'))
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging'],
      locale: 'en-US'
    })
  context = await launch()
  await context.addCookies([{ url: origin, name: 'slax-locale-test', expires: Math.floor(Date.now() / 1000) + 3600, value: jwt('A') }])
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: buildDir })
  let worker = await until(async () => context.serviceWorkers().find(w => w.url().includes(id)), Boolean, 'worker')
  const snapshot = () => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key)
  await until(snapshot, s => s?.source === 'account' && s.locale === 'zh', 'initial account language')
  console.log('PASS initial /me overrides English Chrome with Chinese account language')
  const settings = await context.newPage()
  await settings.goto(`${origin}/user`)
  await settings.locator('slax-reader-modal').waitFor({ state: 'attached' })
  const articleOrigin = origin.replace('127.0.0.1', 'localhost')
  const pages = await Promise.all([context.newPage(), context.newPage()])
  await Promise.all(pages.map((p, i) => p.goto(`${articleOrigin}/article${i}`)))
  await Promise.all(pages.map(p => p.locator('slax-reader-modal').waitFor({ state: 'attached' })))
  const tabs = await worker.evaluate(async origin => (await chrome.tabs.query({})).filter(t => t.url?.startsWith(`${origin}/article`)), articleOrigin)
  await worker.evaluate(
    async ids => {
      for (const id of ids) await chrome.tabs.sendMessage(id, { action: 'show-collect-popup' })
    },
    tabs.map(t => t.id)
  )
  const titles = () => Promise.all(pages.map(p => p.locator('slax-reader-modal .status span').textContent()))
  await until(titles, a => a.every(t => t?.includes('收藏')), 'Chinese mounted UI')
  await pages[0].evaluate(() => {
    document.querySelector('slax-reader-modal').dataset.instance = 'retained'
  })
  const notify = (page = settings, version = 1) => page.evaluate(version => postMessage({ type: 'slax-reader:account-locale-invalidated', version }, location.origin), version)
  lang = 'en'
  const switchStarted = Date.now()
  await notify()
  await until(snapshot, s => s?.locale === 'en', 'invalidation fetch')
  await until(titles, a => a.every(t => /collect/i.test(t)), 'both existing UIs update')
  assert.equal(await pages[0].locator('slax-reader-modal').getAttribute('data-instance'), 'retained')
  assert.equal(await pages[0].locator('#draft').inputValue(), 'unsaved article note')
  console.log(`PASS trusted dweb invalidation updates two mounted UIs during collection without remount (${Date.now() - switchStarted}ms)`)
  assert.ok(heldCollections.length >= 2, 'real collection requests were held')
  for (const res of heldCollections.splice(0)) res.end(JSON.stringify({ code: 200, message: 'ok', data: { bmId: 1 } }))
  await until(titles, a => a.every(t => t === 'Collected'), 'completed collection status')
  console.log('PASS in-flight collection completes with the new language')
  const sidebar = pages[0].locator('slax-reader-panel')
  await sidebar.locator('.more-icon').waitFor({ state: 'attached' })
  await pages[0].bringToFront()
  await sidebar.locator('.edge-zone').dispatchEvent('mouseenter')
  await sidebar.locator('.more-icon').dispatchEvent('click')
  await sidebar
    .locator('.panel-btn')
    .filter({ hasText: /^Share$/ })
    .dispatchEvent('click')
  const shareOption = sidebar.locator('.option')
  await shareOption.waitFor({ state: 'visible' })
  await until(
    () => shareOption.locator('button').getAttribute('class'),
    value => value === '',
    'initial share option loaded'
  )
  await shareOption.dispatchEvent('click')
  await until(
    () => shareOption.locator('button').getAttribute('class'),
    value => value === 'selected',
    'share option changed'
  )
  const beforeOption = await shareOption.locator('button').getAttribute('class')
  const beforeLabel = await shareOption.textContent()
  lang = 'zh'
  await notify()
  await until(
    () => shareOption.textContent(),
    value => value !== beforeLabel,
    'open share dialog title updates'
  )
  assert.equal(await shareOption.locator('button').getAttribute('class'), beforeOption)
  console.log('PASS open share dialog changes language without resetting selected options')
  await pages[0].keyboard.press('Escape')
  lang = 'en'
  await notify()
  await until(snapshot, value => value?.locale === 'en', 'restore English')
  await pages[0].evaluate(() => {
    const target = document.querySelector('#selection-target')
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 80 }))
  })
  await sidebar
    .locator('.article-selection-menus button')
    .filter({ hasText: /comment/i })
    .dispatchEvent('click')
  const commentInput = sidebar.locator('.article-comments-view textarea')
  await commentInput.fill('unsent comment')
  const placeholder = await commentInput.getAttribute('placeholder')
  lang = 'zh'
  await notify()
  await until(
    () => commentInput.getAttribute('placeholder'),
    value => value !== placeholder,
    'comment placeholder'
  )
  assert.equal(await commentInput.inputValue(), 'unsent comment')
  assert.equal(await commentInput.evaluate(el => el.getRootNode().activeElement === el), true)
  console.log('PASS comment input and focus survive language change')
  lang = 'en'
  await notify()
  await until(snapshot, value => value?.locale === 'en', 'restore English after comment')
  // Switch to the real chat panel; hold an SSE tool operation while language changes.
  await sidebar.locator('.button-wrapper button').nth(1).dispatchEvent('click')
  const chatInput = sidebar.locator('.chat-bot textarea')
  await chatInput.fill('explain this article')
  await chatInput.press('Enter')
  const tips = sidebar.locator('.bubble-message .tips span')
  await until(
    () => tips.allTextContents(),
    a => a.some(t => t.includes('locale query')),
    'stream processing status'
  )
  lang = 'zh'
  await notify()
  await until(
    () => tips.allTextContents(),
    a => a.some(t => t.includes('搜索') && t.includes('locale query')),
    'live Chinese tool status'
  )
  for (const res of chatStreams) res.write(toolEvent('search', 'finished_failed', '{}'))
  await until(
    () => tips.allTextContents(),
    a => a.some(t => t.includes('失败') && t.includes('locale query')),
    'failed subject status'
  )
  assert.equal(await sidebar.locator('.bubble-message .tips span.loading').count(), 0)
  for (const res of chatStreams.splice(0)) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: [{ role: 'assistant', content: 'Answer body stays unchanged.' }] }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  }
  await until(
    () => sidebar.locator('.bubble-message .text').allTextContents(),
    a => a.some(t => t.includes('Answer body stays unchanged.')),
    'answer body'
  )
  assert.equal(await sidebar.locator('.bubble-message .tips span.loading').count(), 0)
  console.log('PASS real SSE tool status translates mid-stream, preserves subject on failure and completes answer')
  lang = 'en'
  await notify()
  await until(snapshot, value => value?.locale === 'en', 'restore English after chat')
  const before = meCalls
  await notify(settings, 999)
  await delay(1200)
  assert.equal(meCalls, before)
  console.log('PASS unsupported protocol is ignored')
  await context.addCookies([{ url: origin, name: 'slax-locale-test', expires: Math.floor(Date.now() / 1000) + 3600, value: jwt('A', 2) }])
  await until(snapshot, s => s?.locale === 'en' && s.accountKey === 'id:A', 'same account cookie rotation')
  failMe = true
  await notify()
  await delay(1500)
  assert.equal((await snapshot()).locale, 'en')
  console.log('PASS same-account token rotation and failed /me preserve confirmed language')
  failMe = false
  lang = 'zh'
  await notify()
  await until(snapshot, s => s?.locale === 'zh', 'recover network')
  account = 'B'
  lang = 'en'
  await context.addCookies([{ url: origin, name: 'slax-locale-test', expires: Math.floor(Date.now() / 1000) + 3600, value: jwt('B') }])
  await until(snapshot, s => s?.accountKey === 'id:B' && s.source === 'account' && s.locale === 'en', 'account switch')
  console.log('PASS account switch replaces identity-bound language')
  const previousGeneration = (await snapshot()).generation
  await worker.evaluate(key => chrome.storage.local.remove(key), key)
  await until(snapshot, s => s && s.generation !== previousGeneration, 'generation recovery')
  await until(snapshot, s => s?.source === 'account', 'cache reset reload')
  console.log('PASS storage removal re-handshakes and creates a new generation')
  // Restart Chrome with the same profile and a failing account API.
  // This starts a fresh MV3 worker while preserving the actual local cache.
  const saved = await snapshot()
  failMe = true
  await context.close()
  context = await launch()
  const restartCdp = await context.browser().newBrowserCDPSession()
  await restartCdp.send('Extensions.loadUnpacked', { path: buildDir })
  worker = await until(async () => context.serviceWorkers().find(w => w.url().includes(id)), Boolean, 'restarted worker')
  await until(snapshot, s => s?.accountKey === 'id:B' && s.locale === 'en' && s.generation === saved.generation, 'worker cache restore')
  console.log('PASS browser/MV3 worker restart restores same-account cache while API is unavailable')
  await context.clearCookies({ name: 'slax-locale-test' })
  await until(snapshot, s => s?.accountKey === null && s.source === 'browser', 'logout fallback')
  console.log('PASS logout falls back to browser language')
  console.log(`PASS browser integration completed (${meCalls} /me requests, Chrome ${context.browser().version()})`)
} finally {
  for (const res of chatStreams) res.end()
  for (const res of heldCollections) res.end(JSON.stringify({ code: 200, message: 'ok', data: { bmId: 1 } }))
  await context?.close()
  await new Promise(r => {
    server.close(r)
    server.closeAllConnections()
  })
  if (profile) await rm(profile, { recursive: true, force: true })
}
