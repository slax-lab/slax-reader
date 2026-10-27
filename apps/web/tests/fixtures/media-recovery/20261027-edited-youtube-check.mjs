// Local Web with a real generated article read from the local publication service.
// Public metadata comes from the reported bookmark. This is not production deployment evidence.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const origin = process.argv[2] || 'http://localhost:3210'
const publication = process.argv[3] || 'http://localhost:8797'
const id = '7bfac4d4-b662-4194-a6f9-1fb29d018d9a'
const body = await (await fetch(`${publication}/body`)).text()
const article = await (await fetch(`${publication}/article`)).json()
const result = await (await fetch(`${publication}/result`)).json()
assert.equal(result.result, 'ready')
assert.equal(result.status, 'ready')
assert(body.includes('slax-yt-contents'))
const output = await mkdtemp(join(tmpdir(), 'reader-edited-youtube-'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let context
try {
  context = await browser.newContext({ viewport: { width: 1200, height: 1100 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/api/content/**', async route => {
    const response = await route.fetch({ url: `https://r.slax.com/api/content/${id}` })
    const payload = await response.json()
    assert.equal(payload.metadata.role, 'visitor')
    payload.body = await (await fetch(`${publication}/body`)).text()
    assert.equal(payload.body, body)
    await route.fulfill({ response, json: payload })
  })
  await context.route('**/v1/**', async route => {
    if (route.request().method() !== 'GET') return route.abort()
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `https://api-reader.slax.com${url.pathname}${url.search}` })
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } })
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$router)
  await page.evaluate(id => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push(`/b/${id}`), id)
  const root = page.locator('[data-slax-derived="youtube-article"]')
  await root.waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '#nuxt-devtools-container, nuxt-devtools-panel { display: none !important; }' })
  const actual = await root.locator('.slax-pod-p').evaluateAll(nodes => nodes.map(node => {
    const copy = node.cloneNode(true)
    copy.querySelectorAll('.slax-pod-time, .slax-pod-speaker').forEach(el => el.remove())
    return copy.textContent.trim()
  }))
  assert.deepEqual(actual, article.sections.flatMap(s => s.paragraphs.map(p => p.text)))
  assert.deepEqual(await root.locator('.slax-pod-heading').allTextContents(), article.sections.map(s => s.heading))
  const links = root.locator('.slax-yt-contents a')
  assert.equal(await links.count(), article.sections.length)
  const layouts = []
  for (const theme of ['light', 'dark', 'eink']) {
    for (const width of [320, 375, 768, 1200]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.evaluate(({ theme, width }) => {
        document.documentElement.dataset.slaxTheme = theme
        document.documentElement.className = theme
        document.querySelector('.slax-yt-contents').open = width >= 768
      }, { theme, width })
      await root.locator('.slax-yt-edition').scrollIntoViewIfNeeded()
      await root.locator('.slax-yt-edition').evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(output, `${theme}-${width}-introduction.png`) })
      await root.locator('.slax-pod-heading').first().evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(200)
      const layout = await root.evaluate(node => {
        const p = node.querySelector('.slax-pod-p')
        const stamp = p.querySelector('.slax-pod-time').getBoundingClientRect()
        return { overflow: document.documentElement.scrollWidth > innerWidth, fontSize: getComputedStyle(p).fontSize, fontFamily: getComputedStyle(p).fontFamily, lineHeight: getComputedStyle(p).lineHeight, targetWidth: stamp.width, targetHeight: stamp.height }
      })
      assert.equal(layout.overflow, false)
      assert.equal(layout.fontSize, '18px')
      assert(layout.fontFamily.includes('Inter'))
      assert(layout.targetWidth >= 44 && layout.targetHeight >= 44)
      layouts.push({ theme, width, ...layout })
      await page.screenshot({ path: join(output, `${theme}-${width}-reading.png`) })
    }
  }
  await page.evaluate(() => { document.querySelector('.slax-yt-contents').open = true })
  await links.nth(Math.floor(article.sections.length / 2)).click()
  const targetIndex = Math.floor(article.sections.length / 2)
  const top = await page.locator(`#yt-topic-${targetIndex}`).evaluate(el => el.getBoundingClientRect().top)
  assert(top >= 0 && top < 180)
  await page.evaluate(() => { window.__articleSeeks = []; window.addEventListener('slax:youtube-seek', event => window.__articleSeeks.push(event.detail.t)) })
  const stamp = root.locator('.slax-pod-time').nth(1)
  const seekMs = Number(await stamp.getAttribute('data-media-seek'))
  await stamp.focus()
  await stamp.press('Enter')
  await stamp.press('Space')
  // The shared media event also drives YouTube playback.
  const seeks = await page.evaluate(() => window.__articleSeeks)
  assert.deepEqual(seeks, [seekMs / 1000, seekMs / 1000])
  // A new page reads the stored body again in the visitor-only context.
  const fresh = await context.newPage()
  await fresh.goto(origin, { waitUntil: 'domcontentloaded' })
  await fresh.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$router)
  await fresh.evaluate(id => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push(`/b/${id}`), id)
  await fresh.locator('[data-slax-derived="youtube-article"]').waitFor()
  assert.equal(await fresh.locator('.slax-pod-p').count(), actual.length)
  assert.deepEqual(errors, [])
  const evidence = { environment: 'local Web; actual generated article from local MediaBodyService, PostgreSQL and R2; real public bookmark metadata and status', productionDeployment: false, sections: article.sections.length, paragraphs: actual.length, layouts, errors, generation: result, output }
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await context?.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
}
