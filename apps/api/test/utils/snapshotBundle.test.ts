import { describe, expect, it } from 'vitest'
import { SnapshotBundle, snapshotKeys, readEmbeddedSnapshot, loadEmbeddedSnapshot } from '@/utils/snapshotBundle'
import { memoryBucket } from './snapshotBucket'

describe('fixed storage bundles', () => {
  it.each(['<div>Saved body.</div>', '<html><main>Saved body.</main></html>'])('keeps AI text when copying a previously published fragment: %s', async html => {
    const { bucket, objects } = memoryBucket()
    const first = new SnapshotBundle(bucket, 'first')
    await first.write('body.html', html, 'text/html')
    await first.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')

    const result = await new SnapshotBundle(bucket, 'second').copyHtml('html/body/first.html')

    expect(objects.get(result.content_md_key)!.value).toBe('Saved body.')
  })

  it.each([
    ['div fragment', '<div><h2>Saved title</h2><p>Saved body.</p></div>', 'Saved titleSaved body.'],
    ['main fragment', '<main><p>Saved body.</p></main>', 'Saved body.'],
    ['sibling fragments', '<h2>Saved title</h2><p>Saved body.</p>', 'Saved titleSaved body.'],
    ['article fragment', '<article><p>Saved body.</p></article>', 'Saved body.'],
    ['complete document', '<!doctype html><html><head><title>Page title</title></head><body><div>Saved body.</div></body></html>', 'Saved body.'],
    [
      'inert metadata',
      '<div>Saved body.<script id="slax-private-snapshot" type="application/json">{"private":"metadata"}</script><style>hidden css</style><noscript>hidden fallback</noscript></div>',
      'Saved body.'
    ]
  ])('copies AI text from a %s', async (_name, html, expected) => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('html/body/source.html', html)
    await bucket.put('text/body/source.txt', 'Stale source text')

    const result = await new SnapshotBundle(bucket, 'destination').copyHtml('html/body/source.html')

    expect(objects.get(result.content_md_key)!.value).toBe(expected)
    expect(result.content_word_count).toBe(expected.length)
    expect(objects.get(result.content_key)!.value).toContain('Saved body.')
  })

  it('keeps original keys across repeated writes and preserves live objects on discard', async () => {
    const { bucket, objects } = memoryBucket()
    const first = new SnapshotBundle(bucket, 'owner', 'one')
    await first.write('body.html', '<article>First</article>', 'text/html')
    const second = new SnapshotBundle(bucket, 'owner', 'two', { deleteNewObjectsOnDiscard: true })
    await second.copyHtml(snapshotKeys('owner').content_key)
    await second.assertUnchanged()
    await second.discard()
    expect(objects.has('html/body/owner.html')).toBe(true)
    expect(snapshotKeys('owner', true)).toEqual({ content_key: 'pdf/body/owner.pdf', content_md_key: 'text/pdf/owner.txt', sidecar: 'pdf/meta/owner.json' })
  })

  it('embeds inert escaped metadata without adding a sidecar object', async () => {
    const { bucket, objects } = memoryBucket()
    const bundle = new SnapshotBundle(bucket, 'owner')
    await bundle.write('body.html', '<article>Saved</article>', 'text/html')
    const manifest = { schema: 1, kind: 'html', malicious: '</script><script>alert(1)</script>' }
    await bundle.write('media.json', JSON.stringify(manifest), 'application/json')
    const html = objects.get('html/body/owner.html')!.value
    expect(html).not.toContain('</script><script>alert')
    expect(readEmbeddedSnapshot(html)).toEqual({ managed: true, manifest })
    expect([...objects.keys()]).toEqual(['html/body/owner.html'])
    expect(await loadEmbeddedSnapshot(bucket, 'html/body/owner.html')).toEqual({ managed: true, manifest })
  })

  it('retains the original embedded source metadata while overwriting its own fixed key', async () => {
    const { bucket } = memoryBucket()
    const initial = new SnapshotBundle(bucket, 'owner')
    await initial.write('body.html', '<article>Original</article>', 'text/html')
    await initial.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')
    const update = new SnapshotBundle(bucket, 'owner')
    await update.copyHtml('html/body/owner.html')
    expect(readEmbeddedSnapshot(await update.readHtml('html/body/owner.html')).managed).toBe(true)
    await update.assertUnchanged()
  })

  it('fails for missing required HTML and detects changed independent sources', async () => {
    const { bucket } = memoryBucket()
    await expect(loadEmbeddedSnapshot(bucket, 'html/body/missing.html')).rejects.toThrow()
    await bucket.put('html/body/source.html', '<article>Saved</article>')
    const bundle = new SnapshotBundle(bucket, 'destination')
    await bundle.copyHtml('html/body/source.html')
    await bucket.put('html/body/source.html', 'changed')
    await expect(bundle.assertUnchanged()).rejects.toThrow()
  })
})
