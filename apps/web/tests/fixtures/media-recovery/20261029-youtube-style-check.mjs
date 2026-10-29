import transformerDirectives from '@unocss/transformer-directives'
import { createJiti } from 'jiti'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import * as sass from 'sass'
import { createGenerator } from 'unocss'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('@nuxt/test-utils'))('playwright-core')
const { parse, compileStyle } = createRequire(require.resolve('vue'))('@vue/compiler-sfc')
const { default: MagicString } = createRequire(require.resolve('@unocss/transformer-directives'))('magic-string')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const jiti = createJiti(import.meta.url)
const config = await jiti.import(join(root, 'uno.config.ts'), { default: true })
const uno = await createGenerator(config)
const transformer = transformerDirectives({ applyVariable: ['--at-apply', '--style'] })

async function compile(source, filename, scoped = false, id = 'data-v-youtube-check') {
  const css = sass.compileString(source.replaceAll('~~/', `${root}/`), {
    loadPaths: [dirname(filename), join(root, 'node_modules')],
    silenceDeprecations: ['legacy-js-api']
  }).css
  const code = new MagicString(css)
  await transformer.transform(code, filename + '.css', { uno })
  const result = compileStyle({ source: code.toString(), filename, id, scoped })
  assert.deepEqual(result.errors, [])
  return result.code
}

async function componentStyles(path, id) {
  const filename = join(root, path)
  const { descriptor } = parse(await readFile(filename, 'utf8'), { filename })
  return (await Promise.all(descriptor.styles.map(style => compile(style.content, filename, style.scoped, id)))).join('\n')
}

const metrics = node => {
  const p = node.querySelector('.slax-pod-p')
  const heading = node.querySelector('.slax-pod-heading')
  const label = node.querySelector('.slax-yt-contents a span')
  const button = node.querySelector('.slax-yt-chapter-time, .yt-ai-time')
  const style = el => {
    const s = getComputedStyle(el)
    return Object.fromEntries(['fontSize', 'fontFamily', 'lineHeight', 'textAlign', 'marginTop', 'marginBottom', 'paddingLeft', 'borderLeftWidth', 'backgroundColor'].map(key => [key, s[key]]))
  }
  return {
    paragraph: style(p), heading: style(heading), label: style(label), button: style(button),
    lastParagraph: style(node.querySelector('section > .slax-pod-p:last-child')),
    headingSpan: heading.querySelector('span') ? style(heading.querySelector('span')) : null,
    section: style(p.parentElement),
    introduction: node.querySelector('.slax-yt-introduction p') ? style(node.querySelector('.slax-yt-introduction p')) : null,
    method: node.querySelector('.slax-yt-method') ? style(node.querySelector('.slax-yt-method')) : null,
    methodNote: node.querySelector('.slax-yt-method p') ? style(node.querySelector('.slax-yt-method p')) : null,
    target: { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height },
    hiddenStamps: [...node.querySelectorAll('.slax-pod-time')].every(el => getComputedStyle(el).display === 'none'),
    overflow: document.documentElement.scrollWidth > innerWidth,
    accent: getComputedStyle(button).getPropertyValue('--slax-accent').trim()
  }
}

async function check(page, article) {
  const result = await article.evaluate(metrics)
  assert.equal(result.paragraph.fontSize, '18px')
  assert(Math.abs(parseFloat(result.paragraph.lineHeight) - 33.3) < 0.1, JSON.stringify(result))
  assert.equal(result.paragraph.marginTop, '0px')
  assert.equal(result.paragraph.marginBottom, '20px')
  assert.equal(result.lastParagraph.marginBottom, '20px')
  assert.equal(result.paragraph.textAlign, 'start')
  assert.equal(result.paragraph.paddingLeft, '0px')
  assert.equal(result.paragraph.borderLeftWidth, '0px')
  assert.equal(result.paragraph.backgroundColor, 'rgba(0, 0, 0, 0)')
  assert.equal(result.section.marginTop, '0px')
  assert.equal(result.section.marginBottom, '0px')
  assert.equal(result.heading.fontSize, '26px')
  assert.equal(result.heading.lineHeight, '36.4px')
  assert.equal(result.heading.marginTop, '44px')
  assert.equal(result.heading.marginBottom, '20px')
  if (result.headingSpan) assert.equal(result.headingSpan.fontSize, '26px')
  assert.equal(result.label.fontSize, '14px')
  assert.equal(result.label.textAlign, 'start')
  assert.equal(result.label.fontFamily, result.paragraph.fontFamily)
  assert.equal(result.button.fontSize, '12px')
  assert(result.target.width >= 44 && result.target.height >= 44)
  assert.equal(result.hiddenStamps, true)
  assert.equal(result.overflow, false)
  if (result.introduction) {
    assert.equal(result.introduction.fontSize, '18px')
    assert.equal(result.introduction.lineHeight, '33.3px')
    assert.equal(result.introduction.marginTop, '10px')
    assert.equal(result.introduction.marginBottom, '0px')
  }
  if (result.method) {
    assert.equal(result.method.marginTop, '48px')
    assert.equal(result.method.marginBottom, '24px')
    assert.equal(result.methodNote.fontSize, '13px')
    assert.equal(result.methodNote.marginTop, '8px')
    assert.equal(result.methodNote.marginBottom, '8px')
  }
  const button = article.locator('.slax-yt-chapter-time, .yt-ai-time').first()
  await button.focus()
  assert.equal(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
  assert.equal(await button.evaluate(el => getComputedStyle(el).outlineWidth), '2px')
  assert.equal(await button.evaluate(el => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--slax-accent)'
    el.appendChild(probe)
    const matches = getComputedStyle(el).color === getComputedStyle(probe).color
    probe.remove()
    return matches
  }), true)
  return result
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const target = process.argv[2]
  if (target && target !== '--cascade') {
    await page.goto(target, { waitUntil: 'domcontentloaded' })
    const article = page.locator('[data-slax-derived="youtube-article"]').first()
    await article.waitFor()
    const layouts = []
    for (const theme of ['light', 'dark', 'eink']) {
      for (const width of [375, 768, 769, 1200]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate(theme => { document.documentElement.dataset.slaxTheme = theme }, theme)
        await article.locator('.slax-yt-contents').evaluate(el => { el.open = true })
        layouts.push({ theme, width, ...await check(page, article) })
      }
    }
    await page.evaluate(() => {
      window.__youtubeStyleSeeks = []
      window.addEventListener('slax:youtube-seek', event => window.__youtubeStyleSeeks.push(event.detail.t))
    })
    const button = article.locator('.slax-yt-chapter-time, .yt-ai-time').first()
    const heading = button.locator('..')
    const milliseconds = await heading.getAttribute('data-start-ms')
    await button.focus()
    await button.press('Enter')
    await button.press('Space')
    const seeks = await page.evaluate(() => window.__youtubeStyleSeeks)
    assert.equal(seeks.length, 2)
    assert.equal(seeks[0], seeks[1])
    if (milliseconds !== null) assert.equal(seeks[0], Math.floor(Number(milliseconds) / 1000))
    console.log(JSON.stringify({ mode: 'running-page', url: target, layouts, seeks }, null, 2))
  } else {
    const css = [
      await readFile(join(root, 'styles/theme.tokens.css'), 'utf8'),
      await readFile(join(root, 'styles/theme.css'), 'utf8'),
      await compile(await readFile(join(root, 'styles/global.scss'), 'utf8'), join(root, 'styles/global.scss')),
      await componentStyles('app/components/Article/BookmarkArticle.vue', 'data-v-reader-check'),
      await componentStyles('app/components/Snapshot/YoutubeAiArticle.vue', 'data-v-youtube-check'),
      'body { padding: 24px; }'
    ].join('\n')
    const body = expanded => `<article data-slax-derived="youtube-article" class="${expanded ? 'yt-ai-body' : 'slax-pod-article'}">
      <p class="slax-yt-edition">Edited transcript</p>
      <aside class="slax-yt-introduction"><span class="slax-yt-label">Introduction</span><p>Readable introduction.</p></aside>
      <details open class="slax-yt-contents"><summary>Contents <span>1</span></summary><nav><a href="#${expanded ? 'expanded' : 'saved'}"><span>A chapter with wrapping contents text</span><time>0:00</time></a></nav></details>
      <section class="${expanded ? 'yt-ai-section' : 'slax-pod-section'}"><h2 id="${expanded ? 'expanded' : 'saved'}" class="slax-pod-heading ${expanded ? 'yt-ai-heading' : ''}">${expanded ? '<span>Chapter heading</span>' : 'Chapter heading'}<button type="button" class="${expanded ? 'yt-ai-time' : 'slax-yt-chapter-time'}">0:00</button></h2>
      <p class="slax-pod-p slax-pod-playing ${expanded ? 'yt-ai-paragraph' : ''}">${expanded ? '' : '<span class="slax-pod-time" data-media-seek="0" hidden tabindex="-1">00:00</span>'}Paragraph with <span>nested text</span> and preserved inline markup.</p>
      <p class="slax-pod-p ${expanded ? 'yt-ai-paragraph' : ''}">Last paragraph.</p></section>
      <footer class="slax-yt-method"><strong>Method</strong><p>Method note.</p></footer></article>`
    await page.setContent(`<div class="article-detail article-body default" data-v-reader-check>${body(false)}<div id="controls"><section><h2>Ordinary heading</h2><p>Ordinary paragraph</p></section><div class="slax-yt-transcript" data-yt-reading><p class="slax-yt-cue"><span class="slax-yt-cue-time">0:12</span><span class="slax-yt-cue-text">Raw caption</span></p></div><article class="slax-pod-article" data-slax-derived="podcast"><section><h2>Podcast</h2><p class="slax-pod-p slax-pod-playing"><span class="slax-pod-time">00:00</span>Podcast paragraph.</p></section></article></div></div><section class="youtube-ai-article">${body(true)}</section>`)
    await page.locator('.youtube-ai-article').evaluate(el => {
      el.setAttribute('data-v-youtube-check', '')
      el.querySelectorAll('*').forEach(child => child.setAttribute('data-v-youtube-check', ''))
    })
    const baseline = postcss.parse(css)
    baseline.walkRules(rule => { if (rule.selector.includes('data-slax-derived')) rule.remove() })
    const style = await page.addStyleTag({ content: baseline.toString() })
    const negative = () => page.locator('#controls').evaluate(el => [...el.querySelectorAll('*')].map(node => {
      const s = getComputedStyle(node)
      return [s.fontSize, s.fontFamily, s.lineHeight, s.textAlign, s.marginTop, s.marginBottom, s.paddingLeft, s.backgroundColor, s.borderLeftColor, s.display]
    }))
    await page.waitForTimeout(250)
    const before = await negative()
    await style.evaluate((el, css) => { el.textContent = css }, css)
    await page.waitForTimeout(250)
    assert.deepEqual(await negative(), before)
    const layouts = []
    for (const theme of ['light', 'dark', 'eink']) {
      for (const width of [375, 768, 769, 1200]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate(theme => { document.documentElement.dataset.slaxTheme = theme }, theme)
        for (const [path, selector] of [['saved', '.article-detail > article'], ['expanded', '.youtube-ai-article > article']]) {
          layouts.push({ path, theme, width, ...await check(page, page.locator(selector)) })
        }
      }
    }
    console.log(JSON.stringify({ mode: 'compiled-reader-cascade', negativeControlsUnchanged: true, layouts }, null, 2))
  }
} finally {
  await browser.close()
}
