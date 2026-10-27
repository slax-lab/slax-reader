// Run against the Nuxt dev server: node apps/web/tests/fixtures/media-recovery/20261027-browser-check.mjs
// Bookmark and API responses are fixtures. No production data or generation is used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const origin = process.argv[2] || 'http://localhost:3210'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const state = {
  status: 'unavailable', language: null, requested_language: 'en', eligibility: null,
  version: null, format: null, can_generate: false, can_retry: false,
  article_url: null, updated_at: null, body_mode: 'article', body_ready: false
}
try {
  for (const expanded of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let initial = expanded
    let mode = 'failure'
    await page.route('**/v1/**', async route => {
      if (route.request().url().includes('/youtube_article/status')) {
        if (initial) {
          initial = false
          return route.fulfill({ json: { code: 200, message: 'ok', data: { ...state, status: 'generating', body_mode: 'transcript' } } })
        }
        if (mode === 'failure') return route.abort()
        return route.fulfill({ json: { code: 200, message: 'ok', data: { ...state, status: 'generating' } } })
      }
      return route.fulfill({ json: { code: 200, message: 'ok', data: { mark_list: [], comment_list: [], user_list: {} } } })
    })
    await page.route('**/api/content/**', route => route.fulfill({ json: {
      metadata: { title: 'Media recovery fixture', target_url: 'https://youtube.com/watch?v=Jv5B5CEaPJI', site_name: 'YouTube', bookmark_uuid: 'media-check', role: 'visitor', user_id: 1, content_word_count: 20, tags: [], type: 'article' },
      body: '<youtube-player data-video-id="Jv5B5CEaPJI" data-cues="[]"></youtube-player><p>Saved transcript remains readable.</p>'
    } }))
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('#slax-reader-dweb')?.__vue_app__?.config.globalProperties.$router)
    await page.evaluate(() => document.querySelector('#slax-reader-dweb').__vue_app__.config.globalProperties.$router.push('/b/media-check'))
    const view = page.locator(expanded ? '.youtube-ai-article' : '.youtube-article-bar')
    await view.getByText('Could not load the article.').waitFor({ timeout: 30000 })
    for (const theme of ['light', 'dark', 'eink']) {
      for (const width of [320, 768, 1200]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(theme => {
          document.documentElement.dataset.slaxTheme = theme
          document.documentElement.className = theme
        }, theme)
        const retry = view.getByRole('button', { name: 'Retry' })
        await retry.focus()
        assert(await retry.isVisible())
        const box = await view.boundingBox()
        assert(box && box.x >= 0 && box.x + box.width <= width + 1)
      }
    }
    mode = 'working'
    await view.getByRole('button', { name: 'Retry' }).click()
    await view.getByText('Preparing the article', { exact: false }).waitFor()
    assert.deepEqual(errors, [])
    console.log(`${expanded ? 'Expanded' : 'Compact'}: retry and nine theme/width checks passed`)
    await context.close()
  }
} finally {
  await browser.close()
}
