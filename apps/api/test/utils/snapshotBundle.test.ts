import { describe, expect, it, vi } from 'vitest'
import { SnapshotBundle, snapshotKeys, SNAPSHOT_PUBLICATION_MS } from '@/utils/snapshotBundle'

import { memoryBucket } from './snapshotBucket'

describe('snapshot bundles', () => {
  it('registers the complete bundle before the first PUT and does not write when registration fails', async () => {
    const { bucket, objects } = memoryBucket()
    const register = vi.fn(async () => {
      expect(objects.size).toBe(0)
      throw new Error('database unavailable')
    })
    const bundle = new SnapshotBundle(bucket, 'destination', register, 'attempt')
    await expect(bundle.write('body.html', 'body', 'text/html')).rejects.toThrow('database unavailable')
    expect(objects.size).toBe(0)
    expect(register).toHaveBeenCalledWith('snapshots/destination/attempt/body.html')
  })

  it('registers once for all members and refuses late writes', async () => {
    const { bucket, objects } = memoryBucket()
    const register = vi.fn(async () => {})
    const bundle = new SnapshotBundle(bucket, 'destination', register, 'attempt')
    await bundle.write('body.html', 'body', 'text/html')
    await bundle.write('body.txt', 'body', 'text/plain')
    expect(register).toHaveBeenCalledTimes(1)
    const now = vi.spyOn(Date, 'now').mockReturnValue(bundle.createdAt + SNAPSHOT_PUBLICATION_MS)
    try {
      await expect(bundle.write('media.json', '{}', 'application/json')).rejects.toThrow()
      expect(objects.has('snapshots/destination/attempt/media.json')).toBe(false)
    } finally {
      now.mockRestore()
    }
  })
  it('copies one historical HTML revision and derives matching text, ignoring a different legacy text object', async () => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('legacy.html', '<html><body><article>Saved body</article><script>private script</script></body></html>')
    await bucket.put('legacy.txt', 'different revision')
    const bundle = new SnapshotBundle(bucket, 'destination', async () => {}, 'attempt')
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
    const bundle = new SnapshotBundle(bucket, 'destination', async () => {}, 'attempt')
    await expect(bundle.copyHtml('missing')).rejects.toMatchObject({
      name: 'fork_source_not_ready'
    })
    await bundle.write('body.html', 'own', 'text/html')
    await bundle.discard()
    expect([...objects.keys()]).toEqual(['unrelated'])
  })

  it('never overwrites another attempt and retains source HTTP and allowed PDF metadata', async () => {
    const { bucket, objects } = memoryBucket()
    await bucket.put('pdf/body/source.pdf', '%PDF-test', {
      customMetadata: {
        filename: 'original.pdf',
        sha256: 'a'.repeat(64),
        source: 'upload',
        owner: 'secret'
      }
    })
    const first = new SnapshotBundle(bucket, 'destination', async () => {}, 'one')
    const second = new SnapshotBundle(bucket, 'destination', async () => {}, 'two')
    const target = snapshotKeys('destination', 'one', true).content_key
    await first.copy('pdf/body/source.pdf', target)
    await second.copy('pdf/body/source.pdf', snapshotKeys('destination', 'two', true).content_key)
    await first.discard()
    expect(objects.has(snapshotKeys('destination', 'two', true).content_key)).toBe(true)
    expect(objects.get(snapshotKeys('destination', 'two', true).content_key)?.customMetadata).not.toHaveProperty('owner')
    expect(objects.get(snapshotKeys('destination', 'two', true).content_key)?.customMetadata).toMatchObject({ filename: 'original.pdf', source: 'upload' })
  })
})
