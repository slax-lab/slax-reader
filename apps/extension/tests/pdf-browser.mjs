import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const scratch = path.join(root, 'build/pdf-browser')
const extensionBuild = process.env.SLAX_PDF_TEST_OUT_DIR || 'build/pdf-popup-e2e'
await mkdir(scratch, { recursive: true })
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']
let pdf = '%PDF-1.4\n'
const offsets = [0]
objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
const bytes = Buffer.from(pdf)
const file = path.join(scratch, 'local 空 格.pdf')
await writeFile(file, bytes)
const requests = []
let enabled = true
let holdLabs = false
let pendingLabs = []
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') { res.end(); return }
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/document.pdf' || url.pathname === '/download') { res.setHeader('Content-Type', 'application/pdf'); res.end(bytes); return }
  if (!url.pathname.startsWith('/v1/') && url.pathname !== '/events') { res.setHeader('Content-Type', 'text/html'); res.end('<html><title>HTML article</title><body>Normal article</body></html>'); return }
  const body = Buffer.concat(await Array.fromAsync(req))
  if (url.pathname.includes('/bookmark/')) requests.push({ path: url.pathname, query: url.searchParams.get('filename'), body, headers: req.headers })
  if (url.pathname === '/v1/user/labs' && holdLabs) await new Promise(resolve => pendingLabs.push(resolve))
  const data = url.pathname === '/v1/user/me' ? { userId: 'test', lang: 'en' } :
    url.pathname === '/v1/user/labs' ? { features: [{ key: 'pdf', enabled }] } :
    url.pathname === '/v1/bookmark/upload_pdf' ? { bookmark_id: 123456, bookmark_uid: 'test-uid' } :
    url.pathname === '/v1/bookmark/add_url' ? { bmId: '' } : []
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ code: 200, message: 'ok', data }))
})
let context
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  execFileSync(path.join(root, 'node_modules/.bin/wxt'), ['build', '-c', 'tests/wxt.pdf-test.config.mjs'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1', SLAX_ENV: 'development', PUBLIC_BASE_URL: origin, AUTH_BASE_URL: origin,
      SHARE_BASE_URL: 'https://share.invalid', EXTENSIONS_API_BASE_URL: origin, COOKIE_DOMAIN: '127.0.0.1', COOKIE_TOKEN_NAME: 'slax-pdf-test', UNINSTALL_FEEDBACK_URL: `${origin}/uninstall` }
  })
  context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADLESS !== '0', chromiumSandbox: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']
  })
  await context.addCookies([{ url: origin, name: 'slax-pdf-test', value: 'synthetic-token' }])
  const settings = await context.newPage()
  await settings.goto('chrome://extensions')
  await settings.locator('#devMode').click()
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, extensionBuild, 'chrome-mv3') })
  const action = async source => {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })
    const targetInfo = targetInfos.find(item => item.url === source.url())
    assert.ok(targetInfo)
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId })
  }
  const trigger = async (source, expected = /PDF saved|PDF 已保存/) => {
    const before = context.pages().length
    await action(source)
    const frame = source.frameLocator('slax-reader-modal iframe')
    await frame.getByRole('status').filter({ hasText: expected }).waitFor()
    assert.equal(context.pages().length, before, 'collection creates no tab or window')
    return frame
  }
  const local = await context.newPage()
  await local.goto(pathToFileURL(file).href).catch(() => {})
  const sourceTabUrl = local.url()
  let save = await trigger(local)
  const upload = requests.find(r => r.path.endsWith('upload_pdf'))
  assert.deepEqual(upload.body, bytes)
  assert.equal(upload.query, 'local 空 格.pdf')
  assert.equal(upload.headers['content-type'], 'application/pdf')
  assert.equal(upload.headers.authorization, 'Bearer synthetic-token')
  assert.equal(upload.headers['x-client-type'], 'extension')
  assert.equal(local.url(), sourceTabUrl)
  await local.screenshot({ path: path.join(scratch, 'local-inline-saved.png') })
  await local.locator('slax-reader-modal iframe').waitFor({ state: 'detached' })
  console.log('PASS actual toolbar saves local bytes with an in-page overlay and no new window')
  for (const pathname of ['/document.pdf?download=1', '/download?token=synthetic']) {
    const online = await context.newPage()
    await online.goto(origin + pathname).catch(() => {})
    save = await trigger(online, /URL submitted|链接已提交/)
    assert.equal(JSON.parse(requests.filter(r => r.path.endsWith('add_url')).at(-1).body).target_url, origin + pathname)
    await online.locator('slax-reader-modal iframe').waitFor({ state: 'detached' })
    await online.close()
  }
  console.log('PASS automatic online suffix and extensionless PDF save uses the original page')
  enabled = false
  save = await trigger(local, /unavailable for this account|此账号暂不可/)
  assert.equal(requests.filter(r => r.path.endsWith('upload_pdf')).length, 1)
  await save.getByRole('button', { name: /Close collection popup|关闭收藏弹窗/ }).click()
  enabled = true
  holdLabs = true
  save = await trigger(local, /Checking your account|正在检查账号/)
  const uploadsBeforeSwitch = requests.filter(r => r.path.endsWith('upload_pdf')).length
  await action(local)
  assert.equal(await local.locator('slax-reader-modal iframe').count(), 1)
  pendingLabs.splice(0).forEach(resolve => resolve())
  holdLabs = false
  await save.getByRole('status').filter({ hasText: /PDF saved|PDF 已保存/ }).waitFor()
  assert.equal(requests.filter(r => r.path.endsWith('upload_pdf')).length, uploadsBeforeSwitch + 1)
  await local.locator('slax-reader-modal iframe').waitFor({ state: 'detached' })
  console.log('PASS repeated actions reuse the source overlay and submit once')
  const html = await context.newPage()
  await html.goto(origin + '/html.pdf')
  await html.locator('slax-reader-modal').waitFor({ state: 'attached' })
  await action(html)
  for (let i = 0; i < 100 && !requests.some(r => r.path === '/v1/bookmark/add'); i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(requests.some(r => r.path === '/v1/bookmark/add'))
  assert.equal(context.pages().filter(p => p.url().includes('/pdf-save.html')).length, 0)
  console.log('PASS HTML at .pdf path keeps collector')

  await settings.goto(`chrome://extensions/?id=${id}`)
  const fileAccess = settings.locator('#allow-on-file-urls cr-toggle')
  await fileAccess.click()
  await local.bringToFront()
  const waitForFileAccess = async allowed => {
    for (let i = 0; i < 100; i++) {
      const worker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${id}/`))
      const configured = await worker?.evaluate(async ({ source, allowed }) => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url === source)
        return tab && (await chrome.extension.isAllowedFileSchemeAccess()) === allowed && !!(await chrome.action.getPopup({ tabId: tab.id })) === !allowed
      }, { source: local.url(), allowed }).catch(() => false)
      if (configured) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.fail('file permission and native action configuration settle after extension reload')
  }
  await waitForFileAccess(false)
  const uploadsBeforePermission = requests.filter(r => r.path.endsWith('upload_pdf')).length
  await action(local)
  let popupTarget
  for (let i = 0; i < 100 && !popupTarget; i++) {
    popupTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url.startsWith(`chrome-extension://${id}/pdf-save.html`))
    if (!popupTarget) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(popupTarget, 'the toolbar action opens its native extension popup')
  // Playwright omits native action popups from context.pages(); inspect the
  // actual browser-created popup target over its own CDP session instead.
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId })
  let commandId = 0
  const popupCommand = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId
    const cleanup = () => { clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive) }
    const receive = event => {
      if (event.sessionId !== sessionId) return
      const response = JSON.parse(event.message)
      if (response.id !== id) return
      cleanup()
      if (response.error) reject(new Error(response.error.message))
      else resolve(response.result)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Native popup ${method} timed out`)) }, 10_000)
    cdp.on('Target.receivedMessageFromTarget', receive)
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => { cleanup(); reject(error) })
  })
  const popupValue = async expression => {
    const result = await popupCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined)
    return result.result.value
  }
  let guideShown = false
  for (let i = 0; i < 100 && !guideShown; i++) {
    guideShown = await popupValue(`/Allow access to local PDFs|开启本地 PDF 访问权限/.test(document.querySelector('h1')?.textContent || '') && document.querySelector('.switch-demo')?.getAttribute('role') === 'img' && !!document.querySelector('.switch-demo-track')`)
    if (!guideShown) await new Promise(resolve => setTimeout(resolve, 100))
  }
  const screenshot = await popupCommand('Page.captureScreenshot')
  await writeFile(path.join(scratch, 'native-file-permission-guide.png'), Buffer.from(screenshot.data, 'base64'))
  assert.ok(guideShown, 'the native permission popup renders its instructions and bundled screenshot')
  assert.ok(await popupValue(`innerWidth >= 300 && [...document.querySelectorAll('.actions button')].every(button => button.getBoundingClientRect().bottom <= innerHeight)`), 'native popup keeps guidance and recovery buttons visible')
  for (const locale of ['en', 'zh']) {
    await popupValue(`(async () => {
      const key = 'slax:account-locale:v1'
      const current = (await chrome.storage.local.get(key))[key]
      await chrome.storage.local.set({ [key]: { ...current, locale: '${locale}', revision: current.revision + 1 } })
    })()`)
    for (let i = 0; i < 100 && !(await popupValue(`document.querySelector('main').lang === '${locale}'`)); i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(await popupValue(`document.querySelector('main').lang === '${locale}' && document.querySelectorAll('h1').length === 1 && document.querySelectorAll('.permission-guide li').length === 2`))
    assert.ok(await popupValue(`innerHeight <= 600 && document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.actions button')].every(button => button.getBoundingClientRect().bottom <= innerHeight)`), 'localized permission guidance fits the native popup')
    await popupValue(`document.activeElement.blur()`)
    for (let i = 0; i < 3 && !(await popupValue(`document.activeElement === document.querySelector('.primary-action')`)); i++) {
      await popupCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await popupCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    }
    assert.ok(await popupValue(`document.activeElement === document.querySelector('.primary-action') && getComputedStyle(document.activeElement).outlineStyle !== 'none'`), 'settings action has visible keyboard focus')
    await popupValue(`document.activeElement.blur()`)
    const localized = await popupCommand('Page.captureScreenshot')
    await writeFile(path.join(scratch, `native-file-permission-guide-${locale}.png`), Buffer.from(localized.data, 'base64'))
  }
  assert.equal(requests.filter(r => r.path.endsWith('upload_pdf')).length, uploadsBeforePermission)
  const detailsReady = context.waitForEvent('page', { timeout: 10_000 })
  await popupValue(`document.querySelector('.primary-action').click()`)
  const details = await detailsReady
  await details.waitForURL('chrome://extensions/*')
  assert.equal(new URL(details.url()).searchParams.get('id'), id)
  await details.locator('#allow-on-file-urls cr-toggle').click()
  await local.bringToFront()
  await waitForFileAccess(true)
  await trigger(local)
  assert.equal(requests.filter(r => r.path.endsWith('upload_pdf')).length, uploadsBeforePermission + 1)
  assert.deepEqual(requests.filter(r => r.path.endsWith('upload_pdf')).at(-1).body, bytes)
  console.log('PASS native file-permission action bubble shows screenshot and settings, then reinvocation saves after permission reload')
  console.log('Chrome', context.browser().version())
} finally {
  pendingLabs.splice(0).forEach(resolve => resolve())
  await context?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(path.join(scratch, 'profile'), { recursive: true, force: true }).catch(() => {})
}
