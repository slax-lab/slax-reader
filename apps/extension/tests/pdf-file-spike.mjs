import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const scratch = path.join(root, 'build/pdf-spike')
const extensionBuild = process.env.SLAX_PDF_TEST_OUT_DIR || 'build/pdf-popup-e2e'
await mkdir(scratch, { recursive: true })
const filename = path.join(scratch, 'sample 空 格.pdf')
const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
await writeFile(filename, bytes)
let context
try {
  context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
    locale: 'en-US'
  })
  const devSettings = await context.newPage()
  await devSettings.goto('chrome://extensions')
  await devSettings.locator('#devMode').click()
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, extensionBuild, 'chrome-mv3') })
  let page = await context.newPage()
  await page.goto(`chrome-extension://${id}/pdf-save.html`)
  const allowed = async () => {
    if (page.isClosed()) {
      console.log('OBSERVED permission change closed the extension save tab')
      page = await context.newPage()
      await new Promise(resolve => setTimeout(resolve, 2000))
      await page.goto(`chrome-extension://${id}/pdf-save.html`)
      assert.equal(await page.evaluate(async () => (await chrome.storage.session.get('pdf-spike-marker'))['pdf-spike-marker']), undefined)
      console.log('CONFIRMED permission reload cleared storage.session')
    }
    return page.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())
  }
  console.log('browser', context.browser().version(), 'initial file access', await allowed())
  await page.evaluate(() => chrome.storage.session.set({ 'pdf-spike-marker': true }))
  const settings = await context.newPage()
  await settings.goto(`chrome://extensions/?id=${id}`)
  const toggle = settings.locator('#allow-on-file-urls cr-toggle')
  if (await allowed()) await toggle.click()
  await settings.screenshot({ path: path.join(scratch, 'permission-change.png') })
  assert.equal(await allowed(), false)
  console.log('PASS browser setting disables file access')
  await page.evaluate(() => chrome.storage.session.set({ 'pdf-spike-marker': true }))
  const beforeGrant = page
  await toggle.click()
  assert.equal(beforeGrant.isClosed(), true, 'granting file access closes the save page')
  assert.equal(await allowed(), true)
  console.log('PASS browser setting enables file access')
  const result = await page.evaluate(async url => {
    const outcomes = {}
    try { const r = await fetch(url); outcomes.fetch = { ok: r.ok, size: (await r.blob()).size } } catch { outcomes.fetch = 'failed' }
    outcomes.xhr = await new Promise(resolve => {
      const xhr = new XMLHttpRequest()
      const progress = []
      xhr.open('GET', url)
      xhr.responseType = 'blob'
      xhr.timeout = 1000
      xhr.onprogress = e => progress.push({ loaded: e.loaded, total: e.total, lengthComputable: e.lengthComputable })
      xhr.onerror = () => resolve({ error: 'read' })
      xhr.ontimeout = () => resolve({ error: 'timeout' })
      xhr.onload = async () => resolve({ status: xhr.status, bytes: [...new Uint8Array(await xhr.response.arrayBuffer())], progress })
      xhr.send()
    })
    return outcomes
  }, pathToFileURL(filename).href)
  console.log('transport', JSON.stringify(result))
  assert.deepEqual(result.xhr.bytes, [...bytes])
  console.log('PASS direct extension-document XHR bytes match')
  const fileTab = await context.newPage()
  await fileTab.goto(pathToFileURL(filename).href).catch(() => {})
  const original = await page.evaluate(async () => (await chrome.tabs.query({})).some(tab => tab.url?.startsWith('file:')))
  assert.equal(original, true)
  await toggle.click()
  assert.equal(await allowed(), false)
  console.log('PASS file tab exposes original URL and permission can be revoked')
} finally {
  await context?.close()
  await rm(path.join(scratch, 'profile'), { recursive: true, force: true })
}
