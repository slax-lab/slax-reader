// Run the opt-in Nuxt fixture layer first; no real account or backend is used.
// node apps/web/tests/fixtures/session-recovery/browser-check.mjs http://localhost:3217
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const origin = process.argv[2] || 'http://localhost:3217'
const cookieName = 'slax_test'
const screenshotDirectory = '/tmp/slax-snapshot-session-recovery'
await mkdir(screenshotDirectory, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const entry of ['direct', 'client']) {
    for (const scope of ['host', 'domain', 'both']) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const errors = []
      const documents = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame() && new URL(request.url()).pathname.startsWith('/b/')) documents.push(request.url()) })
      await page.route('**/v1/**', route => route.fulfill({ json: { code: 200, message: 'ok', data: { mark_list: [], user_list: {} } } }))
      if (entry === 'client') {
        await page.goto(`${origin}/guide`)
        await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false)
        await page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)))
      }
      const cookies = [{ name: 'unrelated', value: 'keep', url: origin }]
      if (scope !== 'domain') cookies.push({ name: cookieName, value: 'expired-fixture', url: origin })
      if (scope !== 'host') cookies.push({ name: cookieName, value: 'invalid-fixture', domain: new URL(origin).hostname, path: '/' })
      await context.addCookies(cookies)
      const target = '/b/session-public?highlight=fixture#paragraph'
      if (entry === 'direct') await page.goto(origin + target, { waitUntil: 'domcontentloaded' })
      else await page.evaluate(path => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push(path), target)
      await page.getByText('Public fixture content remains readable after session recovery.').waitFor({ timeout: 60000 })
      await page.waitForTimeout(1000)
      assert.equal(page.url(), origin + target)
      assert.equal(documents.length, entry === 'direct' ? 2 : 1, JSON.stringify(documents))
      const remaining = await context.cookies()
      assert(!remaining.some(cookie => cookie.name === cookieName))
      assert(remaining.some(cookie => cookie.name === 'unrelated'))
      assert(!(await page.locator('body').innerText()).includes('Content unavailable'))
      assert.deepEqual(errors, [])
      console.log(`${entry}/${scope}: cookie removed, URL retained, one recovery reload, public content readable`)
      await page.screenshot({ path: `${screenshotDirectory}/${entry}-${scope}.png` })
      await context.close()
    }
  }

  {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
      Object.defineProperty(Document.prototype, 'cookie', {
        get() { return cookie.get.call(this) },
        set(value) { if (!value.startsWith('slax_test=')) cookie.set.call(this, value) },
        configurable: true
      })
    })
    await context.addCookies([{ name: cookieName, value: 'expired-fixture', url: origin }])
    const page = await context.newPage()
    let documents = 0
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++ })
    await page.goto(`${origin}/b/session-public?verification=blocked-cleanup`)
    await page.getByText('Something went wrong').waitFor({ timeout: 60000 })
    await page.waitForTimeout(1000)
    assert.equal(documents, 1)
    assert((await context.cookies()).some(cookie => cookie.name === cookieName))
    console.log('blocked cleanup: one document, error remains visible, no reload loop')
    await page.screenshot({ path: `${screenshotDirectory}/blocked-cleanup.png` })
    await context.close()
  }

  const expiredJwt = `e30.${Buffer.from(JSON.stringify({ id: 'expired-user', exp: 1 })).toString('base64url')}.fixture`
  for (const destination of ['public', 'private']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.route('**/v1/**', route => route.fulfill({ json: { code: 200, message: 'ok', data: { mark_list: [], user_list: {} } } }))
    await page.goto(`${origin}/b/session-public`)
    await page.getByText('Public fixture content remains readable after session recovery.').waitFor({ timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false)
    await page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)))
    await context.addCookies([{ name: cookieName, value: expiredJwt, url: origin }])
    const target = `/b/session-${destination}?verification=expired-jwt#paragraph`
    await page.evaluate(path => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push(path), target)
    await page.waitForTimeout(4000)
    assert.equal(page.url(), origin + target)
    assert(!(await context.cookies()).some(cookie => cookie.name === cookieName))
    if (destination === 'public') assert((await page.locator('body').innerText()).includes('Public fixture content'))
    else assert(!(await page.locator('body').innerText()).includes('Public fixture content'))
    console.log(`expired JWT client/${destination}: preserved snapshot URL despite sync expiry checks`)
    await context.close()
  }

  for (const scenario of [
    { uuid: 'session-private', token: 'expired-fixture', status: 404, reload: true },
    { uuid: 'session-anonymous-401', token: undefined, status: 401, reload: false },
    { uuid: 'session-forbidden', token: 'valid-fixture', status: 403, reload: false },
    { uuid: 'session-unavailable', token: 'valid-fixture', status: 500, reload: false }
  ]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const documents = []
    page.on('response', response => { if (response.request().isNavigationRequest()) documents.push(response.status()) })
    await page.route('**/v1/**', route => route.fulfill({ json: { code: 200, message: 'ok', data: { mark_list: [], user_list: {} } } }))
    if (scenario.token) await context.addCookies([{ name: cookieName, value: scenario.token, url: origin }])
    await page.goto(`${origin}/b/${scenario.uuid}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__)
    await page.waitForTimeout(3000)
    assert.equal(documents.length, scenario.reload ? 2 : 1)
    assert.equal(documents.at(-1), scenario.status)
    assert.equal((await context.cookies()).some(cookie => cookie.name === cookieName), Boolean(scenario.token && !scenario.reload))
    assert(!(await page.locator('body').innerText()).includes('Public fixture content'))
    console.log(`${scenario.uuid}: final ${scenario.status}, ${documents.length - 1} recovery reloads`)
    await context.close()
  }
} finally {
  await browser.close()
}
