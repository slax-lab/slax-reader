import { buildDir, buildTestExtension } from './helpers/build-test-extension.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const chromePath = process.env.CHROME_PATH || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium')
const testJwt = `x.${Buffer.from(JSON.stringify({ id: 'test-user' })).toString('base64url')}.x`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let readyDelayMs = 0

const bridgeHtml = `<!doctype html><script>
fetch('/__delay').then(response => response.json()).then(({ delay }) => {
  if (delay >= 0) setTimeout(() => parent.postMessage({ type: 'slax-bridge-ready' }, '*'), delay)
})
</script>`

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  response.setHeader('Cache-Control', 'no-store')
  if (url.pathname === '/__delay') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ delay: readyDelayMs }))
    return
  }
  if (url.pathname === '/v1/user/me') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: { userId: 1, email: 'test@example.com', lang: 'en', name: 'Test', picture: '', timezone: 'UTC' }, status: 200, message: 'ok' }))
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(url.pathname === '/x/ext-bridge' ? bridgeHtml : '<!doctype html><p>ready</p>')
})

const waitFor = async (read, predicate, message, timeoutMs = 10_000) => {
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
  await buildTestExtension({
    env: {
      CI: '1',
      SLAX_ENV: 'development',
      PUBLIC_BASE_URL: origin,
      AUTH_BASE_URL: origin,
      SHARE_BASE_URL: origin,
      EXTENSIONS_API_BASE_URL: origin,
      COOKIE_DOMAIN: '127.0.0.1',
      COOKIE_TOKEN_NAME: 'slax-offscreen-timing',
      UNINSTALL_FEEDBACK_URL: `${origin}/uninstall`
    }
  })
  const manifest = JSON.parse(await readFile(path.join(buildDir, 'manifest.json'), 'utf8'))
  assert.ok(manifest.permissions.includes('offscreen'))

  profileDir = await mkdtemp(path.join(os.tmpdir(), 'slax-offscreen-timing-'))
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  })
  const cdp = await context.browser().newBrowserCDPSession()
  await context.addCookies([{ url: origin, name: 'slax-offscreen-timing', value: testJwt }])
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: buildDir })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/bridge-test.html`)
  const send = message =>
    page.evaluate(
      payload =>
        new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(payload, response => {
            const error = chrome.runtime.lastError
            error ? reject(new Error(error.message)) : resolve(response)
          })
        }),
      message
    )
  const state = async () => {
    const response = await send({ target: 'slax-offscreen', method: 'debug-state' })
    assert.equal(response?.success, true)
    return response.data
  }
  const createOffscreen = async () => {
    await send({ action: 'query-bookmark-change', url: 'https://example.com/offscreen-timing' })
    await waitFor(
      async () => (await cdp.send('Target.getTargets')).targetInfos.some(target => target.url.includes('/offscreen.html')),
      Boolean,
      'offscreen target did not appear'
    )
  }
  const mount = () => send({ target: 'slax-offscreen', method: 'mount' })
  const unmount = () => send({ target: 'slax-offscreen', method: 'unmount' })

  readyDelayMs = 50_000
  const slowStart = Date.now()
  await createOffscreen()
  await delay(Math.max(0, 49_000 - (Date.now() - slowStart)))
  const beforeReady = await state()
  assert.equal(beforeReady.state, 'loading')
  assert.equal(beforeReady.iframeGeneration, 1)
  const slowReady = await waitFor(state, value => value.state === 'ready', '50 second bridge did not become ready', 5_000)
  assert.equal(slowReady.iframeGeneration, 1)
  console.log(`PASS real 50-second load: ${JSON.stringify({ elapsedMs: Date.now() - slowStart, state: slowReady.state, iframeGeneration: 1 })}`)

  await unmount()
  readyDelayMs = -1
  const timeoutStart = Date.now()
  await mount()
  const timedOut = await waitFor(state, value => value.state === 'failed', '60 second bridge load timeout did not fire', 65_000)
  const elapsedMs = Date.now() - timeoutStart
  assert.ok(elapsedMs >= 59_000, `load timeout fired too early: ${elapsedMs}ms`)
  assert.equal(timedOut.iframeExists, false)
  assert.ok(timedOut.retryAfter - Date.now() > 55_000)
  console.log(`PASS real 60-second timeout: ${JSON.stringify({ elapsedMs, state: timedOut.state, iframeExists: false })}`)
} finally {
  await context?.close().catch(() => undefined)
  await new Promise(resolve => server.close(resolve))
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
}
