// Read the reported public bookmark without authentication or response fixtures.
// Run: node apps/web/tests/fixtures/media-recovery/20261027-public-transcript-check.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const url = 'https://r.slax.com/b/7bfac4d4-b662-4194-a6f9-1fb29d018d9a'
const output = await mkdtemp(join(tmpdir(), 'reader-public-transcript-'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__)
  await page.locator('[data-yt-seek]').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/content/7bfac4d4-b662-4194-a6f9-1fb29d018d9a')
    const data = await response.json()
    const saved = new DOMParser().parseFromString(data.body, 'text/html')
    const player = saved.querySelector('youtube-player')
    const cues = JSON.parse(player.getAttribute('data-cues'))
    const rendered = [...document.querySelectorAll('[data-yt-seek]')].map(el => ({
      t: Number(el.getAttribute('data-yt-seek')),
      text: el.closest('p')?.innerText || el.parentElement.innerText
    }))
    return {
      status: response.status,
      role: data.metadata.role,
      videoId: player.getAttribute('data-video-id'),
      sourceCount: cues.length,
      renderedCount: rendered.length,
      mismatches: cues.flatMap((cue, i) => rendered[i]?.t === cue.t && rendered[i].text.endsWith(cue.text) ? [] : [i]),
      first: cues[0],
      last: cues.at(-1)
    }
  })
  assert.equal(result.status, 200)
  assert.equal(result.role, 'visitor')
  assert.equal(result.videoId, 'Jv5B5CEaPJI')
  assert.equal(result.sourceCount, 925)
  assert.equal(result.renderedCount, result.sourceCount)
  assert.deepEqual(result.mismatches, [])
  assert.equal(result.first.t, 0)
  assert.equal(result.last.t, 1778)
  for (const width of [375, 1200]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.locator('[data-yt-seek]').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `visitor-${width}.png`) })
  }
  assert.deepEqual(pageErrors, [])
  const evidence = { url, scope: 'Public transcript only; AI article and playback are not verified.', ...result, pageErrors, output }
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
