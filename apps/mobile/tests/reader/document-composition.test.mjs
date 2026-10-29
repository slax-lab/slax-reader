import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {readerAssets} from '../../src/reader/embedded.generated.ts'
import {rewriteReaderImageTransports} from '../../src/reader/image-transports.ts'
import {READER_CSP} from '../../src/reader/security.ts'
import {composeReaderDocument, scriptJson} from '../../src/reader/document.ts'

// The per-open template substitution that the module-level precomputation replaced.
function previousComposeReaderDocument(html, options) {
  const replacements = {
    '{{RESET-CSS}}': readerAssets.resetCss, '{{ARTICLE-CSS}}': readerAssets.articleCss, '{{MARK-CSS}}': readerAssets.markCss,
    '{{BOTTOM-LINE-CSS}}': readerAssets.bottomLineCss, '{{WEBVIEW-BRIGDE-JS}}': readerAssets.bridgeJs,
    '{{CONTENT}}': rewriteReaderImageTransports(html, undefined, options.imageProxyOrigins),
  }
  const document = readerAssets.template.replace(/\{\{(?:RESET-CSS|ARTICLE-CSS|MARK-CSS|BOTTOM-LINE-CSS|WEBVIEW-BRIGDE-JS|CONTENT)\}\}/g, marker => replacements[marker])
  const host = readerAssets.nativeHostJs.replace('__SLAX_READER_CONFIGURATION__', scriptJson(options))
  return document.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${READER_CSP}"><meta name="referrer" content="strict-origin-when-cross-origin">\n<script>${host}</script>`)
}

test('precomputed Reader template composes byte-identical documents for the same article and options', async () => {
  const mixed = await readFile(new URL('./fixtures/mixed-article.html', import.meta.url), 'utf8')
  const articles = [
    mixed, '', '<p>Plain</p>',
    '<p>{{CONTENT}} {{RESET-CSS}} {{WEBVIEW-BRIGDE-JS}} __SLAX_READER_CONFIGURATION__</p>',
    '<head><title>Inner</title></head><p>$& $1 $` $\' $$ </script><script>alert(1)</script></p>',
    '<img src="https://images.example/a.png"><img src="http://images.example/b.png"><video src="https://media.example/v.mp4"></video>',
    '<p>\u2028\u2029 unicode – 中文 – emoji 📚</p>',
  ]
  const optionSets = [
    {pageId: 'reader-1', platform: 'ios'},
    {pageId: 'reader-2', platform: 'android', rewriteImageTransports: false},
    {pageId: '</script><b>', platform: 'ios', imageProxyOrigins: ['https://proxy.slax.example'], controlledFixture: true, observeInput: true},
  ]
  for (const html of articles) for (const options of optionSets) {
    const expected = previousComposeReaderDocument(html, options)
    assert.ok(expected.length > readerAssets.template.length)
    assert.equal(composeReaderDocument(html, options), expected, `${options.pageId}: ${html.slice(0, 40)}`)
  }
})

test('per-open composition inserts the article and configuration literally without re-substituting template markers', () => {
  const article = '<p>{{MARK-CSS}} $& __SLAX_READER_CONFIGURATION__</p>'
  const document = composeReaderDocument(article, {pageId: 'page-$&', platform: 'android'})
  assert.equal(document.split(article).length, 2, 'The article is inserted exactly once')
  assert.ok(document.includes(scriptJson({pageId: 'page-$&', platform: 'android'})), 'Configuration is inserted literally, without replacement patterns')
  assert.equal(document.split('<head>').length, 2)
  assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf(article))
})
