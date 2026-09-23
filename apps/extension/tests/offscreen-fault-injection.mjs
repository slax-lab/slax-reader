import { buildDir, buildTestExtension } from './helpers/build-test-extension.mjs'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium')
const headless = process.env.HEADLESS === '1'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const testJwt = `x.${Buffer.from(JSON.stringify({ id: 'test-user' })).toString('base64url')}.x`

const mode = {
  status: 200,
  readyDelayMs: 0,
  dropReplies: false,
  businessError: null
}
let bridgeDocumentRequests = 0
let userMeRequests = 0
const bridgeCookies = []
const sessionErrors = []

// Use the real web-side handshake, including origin/source/request-id validation.
const sessionClient = await build({
  entryPoints: [path.resolve(import.meta.dirname, '../../web/app/utils/extensionBridgeSession.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'SlaxBridgeSession'
})
const bridgeHtml = `<!doctype html>
<html><body><script>
${sessionClient.outputFiles[0].text}
const bridgeClientId = new URLSearchParams(location.hash.slice(1)).get('c')
const sessionReady = SlaxBridgeSession.requestExtensionBridgeSession({
  clientId: bridgeClientId, configuredIds: new Set([bridgeClientId]), environment: 'production'
})
sessionReady.catch(error => fetch('/__session-error', { method: 'POST', body: String(error) }))
const sessionDiagnostics = sessionReady.then(token => ({
  sessionPresent: Boolean(token),
  pageCookiePresent: document.cookie.includes('slax-offscreen-test=')
}))
const getMode = () => fetch('/__mode', { cache: 'no-store' }).then(response => response.json())
Promise.all([getMode(), sessionReady]).then(([mode]) => {
  if (mode.readyDelayMs >= 0) {
    setTimeout(() => window.parent.postMessage({ type: 'slax-bridge-ready' }, '*'), mode.readyDelayMs)
  }
})
window.addEventListener('message', async event => {
  if (typeof event.data?.id !== 'number') return
  const current = await getMode()
  if (current.dropReplies) return
  const result = event.data.method === 'lookup'
    ? {
        state: 'local',
        userKey: 'test-user',
        hasSynced: false,
        hasLocalData: true,
        bookmark: {
          uuid: 'bookmark-1',
          url: event.data.params?.url || 'https://example.com/extreme',
          title: 'Extreme test bookmark',
          alias_title: '',
          host_url: '127.0.0.1',
          site_name: 'Offscreen test',
          content_icon: '',
          content_cover: '',
          content_word_count: 10,
          description: '',
          byline: '',
          status: 'success',
          published_at: null,
          created_at: '2026-08-24T00:00:00.000Z',
          updated_at: '2026-08-24T00:00:00.000Z',
          archived: 'inbox',
          starred: 'unstar',
          tags: [],
          overview: '',
          key_takeaways: [],
          marks: { mark_list: [], user_list: {} }
        }
      }
    : event.data.method === 'userInfo'
      ? {
          userId: 1,
          email: 'test-user',
          name: 'Test User',
          picture: '',
          lang: 'en',
          subscription_end_at: '2099-01-01T00:00:00.000Z',
          subscription_type: 2
        }
    : { ok: true, method: event.data.method, session: await sessionDiagnostics }
  const payload = current.businessError
    ? { id: event.data.id, error: current.businessError }
    : { id: event.data.id, result }
  window.parent.postMessage(payload, '*')
})
</script></body></html>`

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  if (url.pathname === '/__session-error') {
    request.on('data', chunk => sessionErrors.push(String(chunk)))
    response.end('ok')
    return
  }
  if (url.pathname === '/__mode') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(mode))
    return
  }
  if (url.pathname === '/x/ext-bridge') {
    bridgeDocumentRequests += 1
    bridgeCookies.push(request.headers.cookie || '')
    response.statusCode = mode.status
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(mode.status === 200 ? bridgeHtml : `bridge failure ${mode.status}`)
    return
  }
  if (url.pathname === '/v1/user/me') {
    userMeRequests += 1
    response.setHeader('Content-Type', 'text/plain')
    response.end('Worker response is unavailable')
    return
  }
  if (url.pathname === '/selection') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><main><p id="selection-target">Select this text to open the Slax highlight menu.</p></main>')
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><title>Slax bridge tab ${url.searchParams.get('i') || ''}</title><p>ready</p>`)
})

const listen = () =>
  new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
const closeServer = () =>
  new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
const relisten = port =>
  new Promise(resolve => {
    server.listen(port, '127.0.0.1', resolve)
  })

const waitFor = async (read, predicate, message, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await delay(50)
  }
  assert.fail(`${message}; last value: ${JSON.stringify(value)}`)
}

const launch = profileDir =>
  chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless,
    ignoreDefaultArgs: ['--disable-extensions'],
    // CDP loadUnpacked is session-scoped in current Chromium. Load the same
    // unpacked extension at startup too so the restart scenario restores it.
    args: ['--enable-unsafe-extension-debugging', `--load-extension=${buildDir}`]
  })

const targetSnapshot = async cdp => (await cdp.send('Target.getTargets')).targetInfos
const findOffscreenTarget = targets => targets.find(target => target.url.includes('/offscreen.html'))
const findServiceWorkerTarget = (targets, extensionId) => targets.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))
const findServiceWorker = (context, extensionId) => context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${extensionId}/`))

const scenario = (name, data) => console.log(`PASS ${name}: ${JSON.stringify(data)}`)
const openExtensionPage = async (context, extensionId) => {
  let lastError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const page = await context.newPage()
    try {
      await page.goto(`chrome-extension://${extensionId}/bridge-test.html`)
      return page
    } catch (error) {
      lastError = error
      await page.close().catch(() => undefined)
      await delay(100)
    }
  }
  throw lastError
}
let context
let profileDir
try {
  const port = await listen()
  const origin = `http://127.0.0.1:${port}`

  console.log(`Building isolated test extension for ${origin}`)
  await buildTestExtension({
    fastTimings: true,
    env: {
      CI: '1',
      SLAX_ENV: 'development',
      PUBLIC_BASE_URL: origin,
      AUTH_BASE_URL: origin,
      SHARE_BASE_URL: 'https://share.invalid',
      EXTENSIONS_API_BASE_URL: origin,
      COOKIE_DOMAIN: '127.0.0.1',
      COOKIE_TOKEN_NAME: 'slax-offscreen-test',
      UNINSTALL_FEEDBACK_URL: `${origin}/uninstall`
    }
  })

  const manifest = JSON.parse(await readFile(path.join(buildDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  assert.ok(manifest.permissions.includes('offscreen'))

  profileDir = await mkdtemp(path.join(os.tmpdir(), 'slax-offscreen-e2e-'))
  context = await launch(profileDir)
  let cdp = await context.browser().newBrowserCDPSession()
  await context.addCookies([{ url: origin, name: 'slax-offscreen-test', value: testJwt }])
  const installedExtension = await cdp.send('Extensions.loadUnpacked', { path: buildDir })
  const worker = await waitFor(
    async () => {
      const candidate = findServiceWorker(context, installedExtension.id)
      if (!candidate) return null
      const ready = await candidate.evaluate(() => Boolean(globalThis.chrome?.runtime?.onMessage?.hasListeners())).catch(() => false)
      return ready ? candidate : null
    },
    Boolean,
    'extension service worker did not register runtime listeners',
    15_000
  )
  assert.ok(worker, 'extension service worker did not start')
  console.log(
    `Service worker diagnostics: ${JSON.stringify(
      await worker.evaluate(() => ({
        href: location.href,
        hasMessageListeners: chrome.runtime.onMessage.hasListeners(),
        hasOffscreen: Boolean(chrome.offscreen),
        manifestVersion: chrome.runtime.getManifest().manifest_version
      }))
    )}`
  )
  const extensionId = new URL(worker.url()).host
  assert.equal(installedExtension.id, extensionId)
  let testPage = await openExtensionPage(context, extensionId)

  const runtimeMessage = async message => {
    let lastError
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await testPage.evaluate(
          ({ payload, timeoutMs }) =>
            Promise.race([
              new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(payload, response => {
                  const error = chrome.runtime.lastError
                  error ? reject(new Error(error.message)) : resolve(response)
                })
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`runtime message timed out: ${payload.method}`)), timeoutMs))
            ]),
          { payload: message, timeoutMs: 5_000 }
        )
      } catch (error) {
        lastError = error
        await delay(100)
      }
    }
    throw lastError
  }
  const createOffscreen = async () => {
    try {
      const response = await runtimeMessage({ action: 'query-bookmark-change', url: 'https://example.com/offscreen-create' })
      assert.equal(response?.success, true, `offscreen creation failed: ${JSON.stringify(response)}`)
      assert.equal(response?.data?.bookmarkUid, 'bookmark-1')
      await waitFor(
        async () => findOffscreenTarget(await targetSnapshot(cdp)),
        Boolean,
        'offscreen target did not appear after create request',
        5_000
      )
    } catch (error) {
      console.log(`Offscreen creation diagnostics: ${JSON.stringify({ bridgeDocumentRequests, sessionErrors, targets: await targetSnapshot(cdp) })}`)
      throw error
    }
  }
  const debug = (method, { params } = {}) => runtimeMessage({ target: 'slax-offscreen', method, params })
  const setSession = token =>
    token
      ? context.addCookies([{ url: origin, name: 'slax-offscreen-test', value: token }])
      : context.clearCookies({ name: 'slax-offscreen-test', domain: '127.0.0.1' })
  const state = async () => {
    const response = await debug('debug-state')
    assert.equal(response?.success, true, `debug-state failed: ${JSON.stringify(response)}`)
    return response.data
  }
  const mount = () => debug('mount')
  const unmount = () => debug('unmount')
  const call = (method = 'lookup') => debug(method, { params: { url: 'https://example.com/extreme' } })
  const backgroundLookup = () => runtimeMessage({ action: 'query-bookmark-change', url: 'https://example.com/sw-wake' })
  const backgroundSession = async () => ({
    success: true,
    sessionPresent: (await context.cookies(origin)).some(cookie => cookie.name === 'slax-offscreen-test')
  })
  const setMode = next => Object.assign(mode, { status: 200, readyDelayMs: 0, dropReplies: false, businessError: null }, next)

  const requestStart = 0
  console.log('Running initial offscreen mount')
  await createOffscreen()
  await mount()
  const readyA = await waitFor(state, value => value.state === 'ready', 'initial bridge did not become ready')
  assert.equal(bridgeDocumentRequests - requestStart, 1)
  assert.equal(userMeRequests, 0)
  assert.equal(readyA.iframeGeneration, 1)
  assert.ok(bridgeCookies.at(-1)?.includes(`slax-offscreen-test=${testJwt}`), 'bridge iframe did not receive the same-origin session cookie')
  const sessionProbe = await call('status')
  assert.equal(sessionProbe.data.session.sessionPresent, true)
  assert.equal(sessionProbe.data.session.pageCookiePresent, false, 'fixture must reproduce the missing document.cookie session')
  scenario('iframe session without a dweb tab or page cookie', sessionProbe.data.session)
  const userInfoResponse = await runtimeMessage({ action: 'query-user-info' })
  assert.equal(userInfoResponse?.success, true)
  assert.equal(userInfoResponse?.data?.name, 'Test User')
  assert.equal(userInfoResponse?.data?.subscription_end_at, '2099-01-01T00:00:00.000Z')
  assert.equal(userInfoResponse?.data?.subscription_type, 2)
  const extensionStorage = await testPage.evaluate(() => chrome.storage.local.get(null))
  assert.equal(extensionStorage['local:user_info'], undefined)
  assert.equal(userMeRequests, 0)
  scenario('web userInfo remains the only source', { userId: userInfoResponse.data.userId, extensionUserInfoStored: false, userMeRequests })

  const selectionPage = await context.newPage()
  await selectionPage.goto(`${origin}/selection`, { waitUntil: 'load' })
  await waitFor(
    () => selectionPage.evaluate(() => Boolean(document.querySelector('slax-reader-panel')?.shadowRoot?.querySelector('.slax-menus'))),
    Boolean,
    'selection menu container did not mount',
    5_000
  )
  await selectionPage.evaluate(() => {
    const target = document.querySelector('#selection-target')
    const text = target?.firstChild
    if (!target || !text) throw new Error('selection target missing')
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 80 }))
  })
  await waitFor(
    () => selectionPage.evaluate(() => Boolean(document.querySelector('slax-reader-panel')?.shadowRoot?.querySelector('.article-selection-menus'))),
    Boolean,
    'text selection did not show the highlight menu',
    5_000
  )
  const pagesBeforeComment = context.pages().length
  await selectionPage.evaluate(() => {
    const root = document.querySelector('slax-reader-panel')?.shadowRoot
    const button = Array.from(root?.querySelectorAll('.article-selection-menus button') || []).find(element => /comment|评论/i.test(element.textContent || ''))
    if (!(button instanceof HTMLButtonElement)) throw new Error('comment menu button missing')
    button.click()
  })
  await waitFor(
    () => selectionPage.evaluate(() => Boolean(document.querySelector('slax-reader-panel')?.shadowRoot?.querySelector('.article-comments-view'))),
    Boolean,
    'comment action did not open the comment panel',
    5_000
  )
  assert.equal(context.pages().length, pagesBeforeComment)
  assert.equal(userMeRequests, 0)
  await selectionPage.close()
  scenario('text selection comment menu', { menuVisible: true, commentPanelVisible: true, loginTabs: 0, userMeRequests })

  const beforeFanIn = await state()
  await Promise.all(Array.from({ length: 100 }, () => mount()))
  const afterFanIn = await state()
  assert.equal(afterFanIn.mountCount - beforeFanIn.mountCount, 100)
  assert.equal(afterFanIn.iframeGeneration, beforeFanIn.iframeGeneration)
  assert.equal(bridgeDocumentRequests - requestStart, 1)
  scenario('same-token 100-way fan-in', {
    mountDelta: afterFanIn.mountCount - beforeFanIn.mountCount,
    generationDelta: afterFanIn.iframeGeneration - beforeFanIn.iframeGeneration,
    bridgeRequests: bridgeDocumentRequests - requestStart
  })

  const offscreenBeforeCycles = findOffscreenTarget(await targetSnapshot(cdp))
  assert.ok(offscreenBeforeCycles, 'offscreen CDP target was not found')
  const generationBeforeCycles = afterFanIn.iframeGeneration
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const serviceWorkerTarget = await waitFor(
      async () => findServiceWorkerTarget(await targetSnapshot(cdp), extensionId),
      Boolean,
      `service worker target missing at cycle ${cycle}`
    )
    await cdp.send('Target.closeTarget', { targetId: serviceWorkerTarget.targetId })
    const lookup = await backgroundLookup()
    assert.equal(lookup?.success, true, `background lookup failed after SW cycle ${cycle}`)
    await state()
  }
  const afterCycles = await state()
  const offscreenAfterCycles = findOffscreenTarget(await targetSnapshot(cdp))
  assert.equal(offscreenAfterCycles?.targetId, offscreenBeforeCycles.targetId)
  assert.equal(afterCycles.iframeGeneration, generationBeforeCycles)
  const cycleMounts = afterCycles.mountCount - afterFanIn.mountCount
  assert.ok(cycleMounts >= 20 && cycleMounts <= 60, `unexpected mount fan-out across SW cycles: ${cycleMounts}`)
  scenario('20 service-worker stop/wake cycles', {
    offscreenTargetStable: true,
    iframeGeneration: afterCycles.iframeGeneration,
    remountsReused: cycleMounts
  })

  await unmount()
  setMode({ readyDelayMs: 500 })
  const slowBefore = await state()
  await mount()
  const slowLoading = await state()
  assert.equal(slowLoading.state, 'loading')
  const slowReady = await waitFor(state, value => value.state === 'ready', 'slow bridge did not become ready', 1_500)
  assert.equal(slowReady.iframeGeneration - slowBefore.iframeGeneration, 1)
  scenario('slow load below limit', { state: slowReady.state, generationDelta: 1 })

  await unmount()
  setMode({ readyDelayMs: 1_500 })
  const loadTimeoutBefore = await state()
  await mount()
  const loadFailed = await waitFor(state, value => value.state === 'failed', 'load timeout did not fail', 1_500)
  assert.equal(loadFailed.iframeExists, false)
  assert.equal(loadFailed.iframeGeneration - loadTimeoutBefore.iframeGeneration, 1)
  const requestsAtCooldown = bridgeDocumentRequests
  await Promise.all(Array.from({ length: 30 }, () => mount()))
  const duringCooldown = await state()
  assert.equal(duringCooldown.iframeGeneration, loadFailed.iframeGeneration)
  assert.equal(bridgeDocumentRequests, requestsAtCooldown)
  scenario('load timeout and cooldown', { state: duringCooldown.state, iframeExists: duringCooldown.iframeExists, extraRequests: 0 })

  await unmount()
  setMode({ status: 500, readyDelayMs: -1 })
  const fiveHundredRequests = bridgeDocumentRequests
  await mount()
  await waitFor(state, value => value.state === 'failed', '500 bridge did not enter failed', 1_500)
  await Promise.all(Array.from({ length: 30 }, () => mount()))
  assert.equal(bridgeDocumentRequests - fiveHundredRequests, 1)
  scenario('HTTP 500 bounded load', { bridgeRequests: 1 })

  await unmount()
  setMode({ businessError: 'SQL parameter error' })
  await mount()
  const beforeBusiness = await waitFor(state, value => value.state === 'ready', 'business bridge did not become ready')
  const businessResult = await call()
  const afterBusiness = await state()
  assert.equal(businessResult.kind, 'business')
  assert.equal(afterBusiness.state, 'ready')
  assert.equal(afterBusiness.iframeGeneration, beforeBusiness.iframeGeneration)
  assert.equal(afterBusiness.iframeSrc, beforeBusiness.iframeSrc)
  scenario('business error keeps iframe', { kind: businessResult.kind, iframeGeneration: afterBusiness.iframeGeneration })

  setMode({ dropReplies: true })
  const beforeTransport = await state()
  const transportResults = []
  for (let attempt = 0; attempt < 3; attempt += 1) transportResults.push(await call())
  const transportFailed = await state()
  assert.ok(transportResults.every(result => result.kind === 'transport'))
  assert.equal(transportFailed.state, 'failed')
  assert.equal(transportFailed.transportFailures, 3)
  assert.equal(transportFailed.iframeGeneration, beforeTransport.iframeGeneration)
  await delay(850)
  setMode({})
  const recoveryRequests = bridgeDocumentRequests
  await Promise.all(Array.from({ length: 30 }, () => mount()))
  const transportRecovered = await waitFor(state, value => value.state === 'ready', 'transport cooldown did not recover')
  assert.equal(transportRecovered.iframeGeneration - transportFailed.iframeGeneration, 1)
  assert.equal(bridgeDocumentRequests - recoveryRequests, 1)
  scenario('three call timeouts and recovery', { failures: 3, recoveryGenerationDelta: 1, recoveryRequests: 1 })

  await unmount()
  setMode({})
  await mount()
  await waitFor(state, value => value.state === 'ready', 'session A did not become ready')
  const switchATarget = findOffscreenTarget(await targetSnapshot(cdp))
  assert.ok(switchATarget)
  const switchRequests = bridgeDocumentRequests
  await setSession(`x.${Buffer.from(JSON.stringify({ id: 'test-user-b' })).toString('base64url')}.x`)
  await waitFor(
    async () => findOffscreenTarget(await targetSnapshot(cdp)),
    target => Boolean(target && target.targetId !== switchATarget.targetId),
    'offscreen document was not replaced after session switch'
  )
  await Promise.all(Array.from({ length: 50 }, () => mount()))
  const switchB = await waitFor(state, value => value.state === 'ready', 'session B did not become ready')
  assert.equal(switchB.iframeGeneration, 1)
  assert.equal(bridgeDocumentRequests - switchRequests, 1)
  const switchBTarget = findOffscreenTarget(await targetSnapshot(cdp))
  assert.ok(switchBTarget)
  scenario('session switch fan-in', { iframeGeneration: 1, bridgeRequests: 1 })

  const lookupDuringLogout = call()
  const logout = Promise.all([setSession(null), unmount()])
  await Promise.allSettled([lookupDuringLogout, logout])
  const loggedOut = {
    sessionPresent: (await context.cookies(origin)).some(cookie => cookie.name === 'slax-offscreen-test'),
    offscreenExists: Boolean(findOffscreenTarget(await targetSnapshot(cdp)))
  }
  assert.equal(loggedOut.sessionPresent, false)
  assert.equal(loggedOut.offscreenExists, false)
  scenario('concurrent lookup and logout', loggedOut)

  const pagesBeforeLogin = context.pages().length
  const [collectOrAiLoginA, collectOrAiLoginB, selectionLogin] = await Promise.all([
    runtimeMessage({ action: 'check-logined' }),
    runtimeMessage({ action: 'check-logined' }),
    runtimeMessage({ target: 'slax-background', method: 'interactive-auth-required' })
  ])
  assert.equal(collectOrAiLoginA?.success, false)
  assert.equal(collectOrAiLoginB?.success, false)
  assert.equal(selectionLogin?.success, true)
  const loginPages = await waitFor(
    async () => context.pages().filter(page => page.url() === `${origin}/login?from=extension`),
    pages => pages.length,
    'active operation did not open a login tab'
  )
  assert.equal(loginPages.length, 1, 'one active operation opened multiple login tabs')
  assert.equal(context.pages().length, pagesBeforeLogin + 1)
  await loginPages[0].close()
  scenario('active operation login', { collectOrAi: true, selection: true, loginTabs: 1 })

  setMode({})
  const tabRequestStart = bridgeDocumentRequests
  await waitFor(async () => context.cookies(origin), cookies => !cookies.some(cookie => cookie.name === 'slax-offscreen-test'), 'logout cookie cleanup did not settle')
  await delay(500)
  await setSession(testJwt)
  await waitFor(backgroundSession, response => response?.sessionPresent === true, 'background did not observe the restored cookie session')
  await waitFor(
    async () => findOffscreenTarget(await targetSnapshot(cdp)),
    target => Boolean(target && target.targetId !== switchBTarget.targetId),
    'offscreen document was not recreated after session restoration'
  )
  const beforeTabs = await waitFor(state, value => value.state === 'ready', 'tab bridge did not become ready')
  const userMeBeforeTabs = userMeRequests
  const tabs = await Promise.all(
    Array.from({ length: 50 }, async (_, index) => {
      const page = await context.newPage()
      await page.goto(`${origin}/tab?i=${index}`, { waitUntil: 'load' })
      return page
    })
  )
  await waitFor(
    state,
    value => value.callCount - beforeTabs.callCount >= 50 && value.transportFailures === 0,
    '50 complete tabs did not trigger bridge lookups',
    5_000
  )
  const afterTabs = await state()
  assert.equal(bridgeDocumentRequests - tabRequestStart, 1)
  assert.equal(userMeRequests - userMeBeforeTabs, 0, `50 tabs requested /v1/user/me: ${userMeRequests - userMeBeforeTabs}`)
  await Promise.all(tabs.map(page => page.close()))
  await setSession(null)
  scenario('50 complete tabs', { bridgeRequests: 1, bridgeCalls: afterTabs.callCount - beforeTabs.callCount, generationDelta: 1, transportFailures: 0 })

  await waitFor(
    async () => Boolean(findOffscreenTarget(await targetSnapshot(cdp))),
    exists => !exists,
    'offscreen document survived logout after 50 tabs'
  )
  await closeServer()
  await setSession(testJwt)
  await waitFor(backgroundSession, response => response?.sessionPresent === true, 'background did not observe the offline session')
  await waitFor(
    async () => findOffscreenTarget(await targetSnapshot(cdp)),
    Boolean,
    'offline offscreen document was not created'
  )
  const offlineFailed = await waitFor(state, value => value.state === 'failed', 'offline bridge did not fail', 1_500)
  assert.equal(offlineFailed.iframeExists, false)
  assert.equal(offlineFailed.iframeGeneration, 1)
  await relisten(port)
  scenario('network disconnected', { state: offlineFailed.state, iframeExists: offlineFailed.iframeExists })

  await unmount()
  await testPage.close().catch(() => undefined)
  const reloadedExtension = await cdp.send('Extensions.loadUnpacked', { path: buildDir })
  assert.equal(reloadedExtension.id, extensionId)
  testPage = await openExtensionPage(context, extensionId)
  const reloadRequests = bridgeDocumentRequests
  await createOffscreen()
  await mount()
  const afterReload = await waitFor(state, value => value.state === 'ready', 'extension reload did not recover')
  assert.equal(afterReload.iframeGeneration, 1)
  assert.equal(bridgeDocumentRequests - reloadRequests, 1)
  scenario('extension reload', { iframeGeneration: 1, bridgeRequests: 1 })

  await unmount()
  await context.close()
  context = await launch(profileDir)
  cdp = await context.browser().newBrowserCDPSession()
  await context.addCookies([{ url: origin, name: 'slax-offscreen-test', value: testJwt }])
  testPage = await openExtensionPage(context, extensionId)
  const restartedWorker = await waitFor(
    async () => {
      const candidate = findServiceWorker(context, extensionId)
      if (!candidate) return null
      const ready = await candidate.evaluate(() => Boolean(globalThis.chrome?.runtime?.onMessage?.hasListeners())).catch(() => false)
      return ready ? candidate : null
    },
    Boolean,
    'service worker missing after browser restart',
    15_000
  )
  assert.ok(restartedWorker, 'service worker missing after browser restart')
  const restartRequests = bridgeDocumentRequests
  await createOffscreen()
  await mount()
  const afterRestart = await waitFor(state, value => value.state === 'ready', 'browser restart did not recover')
  assert.equal(afterRestart.iframeGeneration, 1)
  assert.equal(bridgeDocumentRequests - restartRequests, 1)
  assert.ok(findOffscreenTarget(await targetSnapshot(cdp)))
  assert.equal(userMeRequests, 0, `extension requested /v1/user/me ${userMeRequests} times`)
  scenario('browser restart', { iframeGeneration: 1, bridgeRequests: 1 })

  console.log(`PASS all offscreen fault-injection scenarios; total /x/ext-bridge requests: ${bridgeDocumentRequests}`)
} finally {
  await context?.close().catch(() => undefined)
  if (server.listening) await closeServer()
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
}
