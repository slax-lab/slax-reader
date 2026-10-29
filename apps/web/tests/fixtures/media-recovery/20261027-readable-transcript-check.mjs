// Local reader with real public responses. No sample transcript or simulated job state.
// This checks presentation; the proxy supplies transport CORS headers for the local origin.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const origin = process.argv[2] || 'http://localhost:3210'
const id = '7bfac4d4-b662-4194-a6f9-1fb29d018d9a'
const output = await mkdtemp(join(tmpdir(), 'reader-readable-transcript-'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  const responses = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/api/content/**', async route => {
    const response = await route.fetch({ url: `https://r.slax.com/api/content/${id}` })
    responses.push({ kind: 'content', status: response.status() })
    await route.fulfill({ response })
  })
  await context.route('**/v1/**', async route => {
    const request = route.request()
    if (request.method() !== 'GET') return route.abort()
    const url = new URL(request.url())
    const response = await route.fetch({ url: `https://api-reader.slax.com${url.pathname}${url.search}` })
    responses.push({ kind: url.pathname, status: response.status() })
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } })
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$router)
  await page.evaluate(id => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push(`/b/${id}`), id)
  await page.locator('[data-yt-reading]').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const evidence = await page.evaluate(() => {
    const root = document.querySelector('[data-yt-reading]')
    const cues = [...root.querySelectorAll('.slax-yt-cue')]
    const groups = []
    for (const cue of cues) {
      if (cue.hasAttribute('data-yt-paragraph-start')) groups.push('')
      groups[groups.length - 1] += ' ' + cue.querySelector('.slax-yt-cue-text').textContent
    }
    return { cues: cues.length, paragraphs: groups.length, firstParagraphs: groups.slice(0, 4), texts: cues.map(c => c.querySelector('.slax-yt-cue-text').textContent), visibleTimestamps: [...root.querySelectorAll('[data-yt-seek]')].filter(el => getComputedStyle(el).display !== 'none').length }
  })
  const sourceResponse = await context.request.get(`https://r.slax.com/api/content/${id}`)
  const source = await sourceResponse.json()
  const expected = await page.evaluate(body => {
    const parsed = new DOMParser().parseFromString(body, 'text/html')
    return [...parsed.querySelectorAll('.slax-yt-cue-text')].map(el => el.textContent)
  }, source.body)
  assert.equal(source.metadata.role, 'visitor')
  assert.deepEqual(evidence.texts, expected)
  assert.equal(evidence.cues, 925)
  assert(evidence.paragraphs < 120 && evidence.paragraphs > 10)
  assert.equal(evidence.visibleTimestamps, evidence.paragraphs)
  const layouts = []
  for (const theme of ['light', 'dark', 'eink']) {
    for (const width of [375, 768, 1200]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(theme => { document.documentElement.dataset.slaxTheme = theme; document.documentElement.className = theme }, theme)
      const first = page.locator('[data-yt-reading] .slax-yt-cue-text').first()
      await first.evaluate(el => el.closest('[data-yt-reading]').scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(250)
      const layout = await page.evaluate(() => {
        const root = document.querySelector('[data-yt-reading]')
        const first = root.querySelector('.slax-yt-cue')
        const target = root.querySelector('[data-yt-seek]').getBoundingClientRect()
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, cueDisplay: getComputedStyle(first).display, font: getComputedStyle(first).fontFamily, hyphens: getComputedStyle(first).hyphens, targetWidth: target.width, targetHeight: target.height }
      })
      assert.equal(layout.overflow, false)
      assert.equal(layout.cueDisplay, 'inline')
      assert(layout.targetWidth >= 44 && layout.targetHeight >= 44)
      layouts.push({ theme, ...layout })
      await page.screenshot({ path: join(output, `${theme}-${width}.png`) })
    }
  }
  const stamp = page.locator('[data-yt-paragraph-start] [data-yt-seek]').nth(1)
  const seekTime = Number(await stamp.getAttribute('data-yt-seek'))
  await page.evaluate(() => { window.__readingSeeks = []; window.addEventListener('slax:youtube-seek', e => window.__readingSeeks.push(e.detail.t)) })
  await stamp.focus()
  await stamp.press('Enter')
  await stamp.press('Space')
  assert.deepEqual(await page.evaluate(() => window.__readingSeeks), [seekTime, seekTime])
  assert.deepEqual(errors, [])
  delete evidence.texts
  const result = { input: id, environment: 'local Web build with public production content and status responses', productionDeployment: false, ...evidence, layouts, responses, errors, output }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
