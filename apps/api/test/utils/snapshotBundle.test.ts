import { describe, expect, it } from 'vitest'
import { SnapshotBundle, snapshotKeys } from '@/utils/snapshotBundle'

import { memoryBucket } from './snapshotBucket'

describe('snapshot bundles', () => {
  it('copies one historical HTML revision and derives matching text, ignoring a different legacy text object', async () => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('legacy.html', '<html><body><article>Saved body</article><script>private script</script></body></html>')
    await bucket.put('legacy.txt', 'different revision')
    const bundle = new SnapshotBundle(bucket, 'destination', 'attempt')
    const copied = await bundle.copyHtml('legacy.html')
    expect(objects.get(copied.content_key)?.value).toContain('Saved body')
    expect(objects.get(copied.content_md_key)?.value).toBe('Saved body')
    await bundle.assertUnchanged()
    await bucket.put('legacy.html', 'new revision')
    await expect(bundle.assertUnchanged()).rejects.toMatchObject({ name: 'fork_source_not_ready' })
  })

  it('fails closed for a missing object and cleans only its own attempted keys', async () => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('unrelated', 'keep')
    const bundle = new SnapshotBundle(bucket, 'destination', 'attempt')
    await expect(bundle.copyHtml('missing')).rejects.toMatchObject({ name: 'fork_source_not_ready' })
    await bundle.write('body.html', 'own', 'text/html')
    await bundle.discard()
    expect([...objects.keys()]).toEqual(['unrelated'])
  })

  it('never overwrites another attempt and retains source HTTP and allowed PDF metadata', async () => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('pdf/body/source.pdf', '%PDF-test', { customMetadata: { filename: 'original.pdf', sha256: 'a'.repeat(64), source: 'upload', owner: 'secret' } })
    const first = new SnapshotBundle(bucket, 'destination', 'one')
    const second = new SnapshotBundle(bucket, 'destination', 'two')
    const target = snapshotKeys('destination', 'one', true).content_key
    await first.copy('pdf/body/source.pdf', target)
    await second.copy('pdf/body/source.pdf', snapshotKeys('destination', 'two', true).content_key)
    await first.discard()
    expect(objects.has(snapshotKeys('destination', 'two', true).content_key)).toBe(true)
    expect(objects.get(snapshotKeys('destination', 'two', true).content_key)?.customMetadata).not.toHaveProperty('owner')
    expect(objects.get(snapshotKeys('destination', 'two', true).content_key)?.customMetadata).toMatchObject({ filename: 'original.pdf', source: 'upload' })
  })
})
