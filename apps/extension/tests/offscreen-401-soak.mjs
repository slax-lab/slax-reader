import { buildDir, buildTestExtension } from './helpers/build-test-extension.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium')
const headless = process.env.HEADLESS === '1'
const durationMs = Number(process.env.SOAK_DURATION_MS || 10 * 60_000)
const tabIntervalMs = Number(process.env.SOAK_TAB_INTERVAL_MS || 5_000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const testJwt = `x.${Buffer.from(JSON.stringify({ id: 'test-user' })).toString('base64url')}.x`
const bridgeRequestTimes = []

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  if (url.pathname === '/x/ext-bridge') {
    bridgeRequestTimes.push(Date.now())
    response.statusCode = 401
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Unauthorized</title><p>401 Unauthorized</p>')
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><title>401 soak tab ${url.searchParams.get('i') || ''}</title><p>ready</p>`)
})

const waitFor = async (read, predicate, message, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await delay(100)
  }
  assert.fail(`${message}; last value: ${JSON.stringify(value)}`)
}

let context
let profileDir
try {
  const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  const origin = `http://127.0.0.1:${port}`

  console.log(`Building extension with production offscreen timings for ${origin}`)
  await buildTestExtension({
    env: {
      CI: '1',
      SLAX_ENV: 'development',
      PUBLIC_BASE_URL: origin,
      AUTH_BASE_URL: origin,
      SHARE_BASE_URL: origin,
      EXTENSIONS_API_BASE_URL: origin,
      COOKIE_DOMAIN: '127.0.0.1',
      COOKIE_TOKEN_NAME: 'slax-offscreen-401-soak',
      UNINSTALL_FEEDBACK_URL: `${origin}/uninstall`
    }
  })

  const manifest = JSON.parse(await readFile(path.join(buildDir, 'manifest.json'), 'utf8'))
  assert.ok(manifest.permissions.includes('offscreen'))

  profileDir = await mkdtemp(path.join(os.tmpdir(), 'slax-offscreen-401-soak-'))
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  })
  const cdp = await context.browser().newBrowserCDPSession()
  await context.addCookies([{ url: origin, name: 'slax-offscreen-401-soak', value: testJwt }])
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: buildDir })
  const extensionPage = await context.newPage()
  await extensionPage.goto(`chrome-extension://${extensionId}/bridge-test.html`)

  const send = message =>
    extensionPage.evaluate(
      payload =>
        new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(payload, response => {
            const error = chrome.runtime.lastError
            error ? reject(new Error(error.message)) : resolve(response)
          })
        }),
      message
    )
  const initialLookup = send({ action: 'query-bookmark-change', url: 'https://example.com/401-soak' }).catch(() => undefined)
  await waitFor(async () => bridgeRequestTimes.length, count => count === 1, 'initial 401 was not observed')
  await waitFor(
    async () => context.cookies(origin),
    cookies => !cookies.some(cookie => cookie.name === 'slax-offscreen-401-soak'),
    '401 did not clear the same-origin session cookie'
  )
  await waitFor(
    async () => (await cdp.send('Target.getTargets')).targetInfos.some(target => target.url.includes('/offscreen.html')),
    exists => !exists,
    '401 did not teardown the offscreen document'
  )
  await initialLookup
  assert.equal(context.pages().filter(page => page.url() === `${origin}/login?from=extension`).length, 0, 'passive 401 opened a login tab')
  const extensionStorage = await extensionPage.evaluate(() => chrome.storage.local.get(null))
  assert.equal(Object.prototype.hasOwnProperty.call(extensionStorage, 'token'), false, 'extension persisted the browser session token')
  assert.equal(Object.values(extensionStorage).includes(testJwt), false, 'extension persisted the browser session value')

  const authState = async () => {
    const offscreenExists = (await cdp.send('Target.getTargets')).targetInfos.some(target => target.url.includes('/offscreen.html'))
    const sessionPresent = (await context.cookies(origin)).some(cookie => cookie.name === 'slax-offscreen-401-soak')
    return { sessionPresent, offscreenExists }
  }

  const startedAt = Date.now()
  let nextTabAt = startedAt
  let nextReportAt = startedAt + 30_000
  let tabsOpened = 0
  console.log(`Starting ${durationMs / 60_000}-minute 401 soak; opening one new page every ${tabIntervalMs / 1_000}s`)

  while (Date.now() - startedAt < durationMs) {
    const now = Date.now()
    if (now >= nextTabAt) {
      const page = await context.newPage()
      await page.goto(`${origin}/tab?i=${tabsOpened}`, { waitUntil: 'load' })
      await page.close()
      tabsOpened += 1
      nextTabAt += tabIntervalMs
    }
    if (now >= nextReportAt) {
      const current = await authState()
      console.log(
        `SOAK ${Math.round((now - startedAt) / 1_000)}s: ${JSON.stringify({
          tabsOpened,
          bridge401s: bridgeRequestTimes.length,
          sessionPresent: current.sessionPresent,
          offscreenExists: current.offscreenExists
        })}`
      )
      nextReportAt += 30_000
    }
    await delay(Math.min(250, Math.max(0, nextTabAt - Date.now())))
  }

  const finalState = await authState()
  const requestOffsetsMs = bridgeRequestTimes.map(timestamp => timestamp - startedAt)
  const requestGapsMs = bridgeRequestTimes.slice(1).map((timestamp, index) => timestamp - bridgeRequestTimes[index])
  assert.ok(tabsOpened >= Math.floor(durationMs / tabIntervalMs) - 1, `too few pages opened: ${tabsOpened}`)
  assert.equal(bridgeRequestTimes.length, 1, `401 bridge request repeated after session expiry: ${JSON.stringify(requestGapsMs)}`)
  assert.equal(context.pages().filter(page => page.url() === `${origin}/login?from=extension`).length, 0, 'passive 401 opened a login tab')
  assert.deepEqual(finalState, { sessionPresent: false, offscreenExists: false })
  console.log(
    `PASS 401 soak: ${JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      tabsOpened,
      bridge401s: bridgeRequestTimes.length,
      requestOffsetsMs,
      requestGapsMs,
      finalState
    })}`
  )
} finally {
  await context?.close().catch(() => undefined)
  await new Promise(resolve => server.close(resolve))
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
}
