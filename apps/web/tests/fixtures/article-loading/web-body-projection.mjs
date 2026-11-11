// Run from the repository root; uses the real Worker HTMLRewriter.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const web = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(resolve(web, 'package.json'))
const wrangler = createRequire(require.resolve('wrangler'))
const { build } = wrangler('esbuild')
const { Miniflare } = wrangler('miniflare')
const { parseFragment, serialize } = await import(require.resolve('parse5'))
const prefix = 'https://api.example.com/static/image'
const proxy = (source, mode, endpoint = prefix) => {
  const url = new URL(endpoint)
  url.searchParams.set('u', encodeURIComponent(source))
  url.searchParams.set('r', 'https://example.com/article')
  url.searchParams.set('d', 'fixture-digest')
  if (mode) url.searchParams.set('m', mode)
  return url.href
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const inner = proxy('https://images.example.com/a.png?name=a%2Fb&size=2').replace('%3A', '%3a')
const outer = proxy(inner)
const image = source => `<img id="image" src="${escape(source)}" alt="Original" loading="eager" fetchpriority="high">`
const nodes = root => [root, ...(root.childNodes || []).flatMap(nodes)]
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const sourceOf = html => attr(nodes(parseFragment(html)).find(node => node.tagName === 'img'), 'src')
const { outputFiles } = await build({
  stdin: { contents: `import { projectWebArticleBody } from './server/utils/webArticleBody.ts';
    export default { async fetch(request) { return new Response(await projectWebArticleBody(await request.text(), request.headers.get('x-proxy-prefix') || '${prefix}')); } };`,
    resolveDir: web, sourcefile: 'projection-worker.ts', loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent'
})
const mf = new Miniflare({ workers: [{ config: {
  name: 'article-projection', type: 'worker', compatibilityDate: '2026-01-01',
  manifest: { mainModule: 'worker.js', modulesRoot: web, modules: { 'worker.js': { type: 'esm', contents: outputFiles[0].text } } }
} }] })
const project = async (body, endpoint = prefix) => (await mf.dispatchFetch('http://projection/', { method: 'POST', body, headers: { 'x-proxy-prefix': endpoint } })).text()
try {
  const visible = `<h2 id="chapter">Chapter</h2><p id="paragraph" data-cues='[{"t":120}]'>Complete transcript &amp; original text.</p><audio preload="none" src="episode.mp3" data-duration-ms="3600000"></audio>`
  const kept = '<script id="other" type="application/json">{"keep":true}</script><script id="slax-private-snapshot" type="text/plain">Keep other type</script><div id="slax-private-snapshot">Keep other element</div>'
  const raw = visible + '<script id="slax-private-snapshot" type="application/json">{"private":"manifest"}</script>' + kept + image(outer)
  const result = await project(raw)
  assert.equal(result, visible + kept + image(inner), 'remove only the manifest and one supported image wrapper, preserving all other bytes')
  assert.equal(sourceOf(result), inner, 'preserve the complete signed URL value after HTML parsing')
  assert.equal(await project(result), result, 'projection is idempotent')
  const quotedInner = inner + '&extra=" onerror="window.unwanted=true'
  const quotedResult = parseFragment(await project(image(proxy(quotedInner))))
  const quotedImage = nodes(quotedResult).find(node => node.tagName === 'img')
  assert.equal(attr(quotedImage, 'src'), quotedInner, 'serializer preserves quotes inside the URL value')
  assert.equal(attr(quotedImage, 'onerror'), undefined, 'URL text never becomes another HTML attribute')
  assert.equal(sourceOf(await project(image(outer).replaceAll('&amp;', '&#38;'))), inner, 'decode numeric ampersands')
  assert.equal(sourceOf(await project(image(outer).replaceAll('&amp;', '&#x26;'))), inner, 'decode hexadecimal ampersands')
  for (const source of [
    inner, 'data:image/png;base64,AAAA', 'not-a-url', proxy(inner, 'rss'), proxy(proxy('https://images.example.com/a.png', 'rss')),
    proxy(inner, undefined, 'https://foreign.example.com/static/image'),
    proxy(proxy('https://images.example.com/a.png', undefined, 'https://api.example.com/other')),
    proxy(inner.replace(/&d=[^&]+/, '')), proxy(outer), proxy(inner.replace('api.example.com', 'api.example.com.evil.test')),
    outer.replace(/&r=[^&]+/, ''), outer.replace(/&d=[^&]+/, ''), proxy(inner, 'unknown')
  ]) assert.equal(await project(image(source)), image(source), `leave unsupported input unchanged: ${source}`)
  assert.equal(sourceOf(await project(image(proxy(proxy('https://images.example.com/rss.png', 'rss'), 'rss')))), proxy('https://images.example.com/rss.png', 'rss'))
  assert.equal(await project(`<video poster="${escape(outer)}"><source src="${escape(outer)}"></video>`), `<video poster="${escape(outer)}"><source src="${escape(outer)}"></video>`, 'do not broaden the observed image fix to unobserved media attributes')
  console.log('PASS: exact projection, signed bytes, attribute entities, modes, unsupported sources, idempotence and visible anchors/media')
  // Optional anonymous captures are never committed as fixtures.
  if (process.argv[2]) {
    const { gzipSync } = await import('node:zlib')
    for (const name of ['podcast', 'mole']) {
      const full = readFileSync(resolve(process.argv[2], `${name}.html`), 'utf8')
      const projected = await project(full, 'https://api-reader.slax.com/static/image')
      const before = gzipSync(full, { level: 6 }).length
      const after = gzipSync(projected, { level: 6 }).length
      console.log(JSON.stringify({ capture: name, before, after, reduction: 1 - after / before }))
      const videos = nodes(parseFragment(full)).filter(node => node.tagName === 'video')
      console.log(JSON.stringify({ capture: name, videos: videos.length, posters: videos.map(node => attr(node, 'poster') || null) }))
    }
  }
} finally { await mf.dispose() }
