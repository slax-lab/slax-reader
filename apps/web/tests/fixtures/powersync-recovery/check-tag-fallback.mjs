// Run against serve-tag-fallback.mjs; exercises real components and HTTP envelopes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const origin = process.argv[2] || 'http://127.0.0.1:3212'
const output = process.argv[3] || '/tmp/powersync-tag-fallback'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const control = async (mode, reset = false) => (await page.request.get(`${origin}/__fixture/control?mode=${mode}${reset ? '&reset=1' : ''}`)).json()
const count = () => page.locator('#change-count').innerText()
const chips = () => page.locator('.tags-cells .tag-name')
async function open() {
  await page.locator('.tag-add').click()
  await page.locator('.search-list .search-tag').first().waitFor()
}
async function removeTech() {
  const chip = page.locator('.tags-cells > span').filter({ has: page.locator('.tag-name', { hasText: /^tech$/ }) })
  await chip.hover()
  await chip.getByRole('button', { name: 'Delete', exact: true }).click()
}
async function expectCount(value) {
  await page.waitForFunction(value => document.querySelector('#change-count')?.textContent === `Successful changes: ${value}`, value)
}
try {
  await control('success', true)
  const invalid = await page.request.post(`${origin}/v1/bookmark/add_tags`, { data: { bookmark_id: 7, tags: [{ id: 3 }] } })
  assert.equal(invalid.status(), 400, 'The fixture must reject id-only tags just as the contract requires a name')
  for (const surface of ['list', 'detail']) {
    await control('success', true)
    await page.goto(`${origin}/?surface=${surface}`)
    await open()
    await page.locator('.search-tag').filter({ hasText: /^Friendly design$/ }).click()
    await page.locator('.search-list input').fill('fresh')
    await page.locator('.search-tag.create').click()
    await control('http-error')
    await page.locator('.confirm-btn').click()
    await page.locator('#feedback').filter({ hasText: /./ }).waitFor()
    assert.equal(await page.locator('.search-list input').inputValue(), 'fresh')
    assert.equal(await page.locator('.confirm-btn').innerText(), 'Done (2)')
    assert.equal(await count(), 'Successful changes: 0')
    await page.screenshot({ path: `${output}/${surface}-failed-add.png` })
    await control('success')
    await page.locator('.confirm-btn').click()
    await expectCount(1)
    assert.deepEqual(await chips().allTextContents(), ['tech', 'design', 'fresh'])
    for (const mode of ['http-error', 'no-result', 'unauthorized']) {
      await control(mode)
      await removeTech()
      await page.waitForFunction(() => !document.querySelector('.loading'))
      assert.deepEqual(await chips().allTextContents(), ['tech', 'design', 'fresh'])
      assert.equal(await count(), 'Successful changes: 1')
    }
    await control('success')
    await removeTech()
    await expectCount(2)
    assert.deepEqual(await chips().allTextContents(), ['design', 'fresh'])
    const state = await control('success')
    assert.deepEqual(state.requests[0].body, { bookmark_id: 7, tags: [{ id: 3, name: 'design' }, { name: 'fresh' }] })
    assert.deepEqual(state.requests.at(-1).body, { bookmark_id: 7, tag_id: 1 })
    for (const theme of ['light', 'dark', 'eink']) {
      for (const width of [320, 768, 1200]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(theme => {
          document.documentElement.dataset.slaxTheme = theme
          document.documentElement.className = theme
        }, theme)
        await page.locator('.tag-add').focus()
        assert(await page.locator('.tag-add').isVisible())
        await page.screenshot({ path: `${output}/${surface}-${theme}-${width}.png` })
      }
    }
    await page.locator('#readonly').click()
    assert.equal(await page.locator('.tag-add').count(), 0)
    assert.equal(await page.locator('.tags-cells .tag-act.remove').count(), 0)
    console.log(`${surface}: HTTP add/create/retry/remove, failure preservation (500/undefined/401), read-only and 9 theme/width checks passed`)
  }
  await page.goto(`${origin}/?surface=local-only`)
  await control('success', true)
  await removeTech()
  assert.equal(await count(), 'Successful changes: 0')
  assert.deepEqual((await control('success')).requests, [])
  assert.deepEqual(errors, [])
  console.log(`Local-only UUID guard passed; screenshots: ${output}`)
} finally {
  await browser.close()
}
