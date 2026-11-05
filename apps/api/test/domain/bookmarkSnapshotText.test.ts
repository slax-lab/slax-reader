import { describe, expect, it, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { memoryBucket } from '../utils/snapshotBucket'
import { SnapshotBundle } from '@/utils/snapshotBundle'

function setup() {
  const { bucket, objects } = memoryBucket()
  const service = Object.assign(Object.create(BookmarkService.prototype), { bucket: () => ({ R2Bucket: bucket }) }) as BookmarkService
  return { bucket, objects, service }
}

describe('saved snapshot AI text', () => {
  it.each(['<div>My saved body.</div>', '<html><head><title>Page title</title></head><main>My saved body.</main></html>'])(
    'recovers a historical copy containing the real publication marker structure: %s',
    async html => {
      const { bucket, service } = setup()
      const bundle = new SnapshotBundle(bucket, 'copy')
      await bundle.write('body.html', html, 'text/html')
      await bundle.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')
      await bucket.put('text/body/copy.txt', '')

      expect(await service.getBookmarkContent('text/body/copy.txt')).toBe('My saved body.')
    }
  )

  it('recovers an existing empty copy from its own HTML without changing storage', async () => {
    const { bucket, objects, service } = setup()
    await bucket.put('text/body/copy.txt', '')
    await bucket.put('html/body/copy.html', '<div>My saved body.<script>hidden</script></div>')
    await bucket.put('html/body/source.html', '<article>Different source body.</article>')
    const before = structuredClone([...objects])

    expect(await service.getBookmarkContent('text/body/copy.txt')).toBe('My saved body.')
    expect([...objects]).toEqual(before)
  })

  it('keeps nonempty text verbatim without reading HTML', async () => {
    const { bucket, service } = setup()
    await bucket.put('text/body/copy.txt', '  Saved text\n')
    const read = vi.spyOn(bucket, 'get')
    expect(await service.getBookmarkContent('text/body/copy.txt')).toBe('  Saved text\n')
    expect(read.mock.calls.map(([key]) => key)).toEqual(['text/body/copy.txt'])
  })

  it.each(['text/pdf/copy.txt', 'legacy/copy.txt'])('keeps empty %s outside HTML recovery', async key => {
    const { bucket, service } = setup()
    await bucket.put(key, '')
    await bucket.put('html/body/copy.html', '<article>Unrelated body</article>')
    expect(await service.getBookmarkContent(key)).toBe('')
  })

  it('retains unavailable content when the saved HTML is missing', async () => {
    const { bucket, service } = setup()
    await bucket.put('text/body/copy.txt', '')
    expect(await service.getBookmarkContent('text/body/copy.txt')).toBe('')
  })

  it('retains empty content when the saved HTML has no readable text', async () => {
    const { bucket, service } = setup()
    await bucket.put('text/body/copy.txt', '')
    await bucket.put('html/body/copy.html', '<div><script>metadata</script><style>css</style></div>')
    expect(await service.getBookmarkContent('text/body/copy.txt')).toBe('')
  })

  it('does not recover a missing text object', async () => {
    const { bucket, service } = setup()
    await bucket.put('html/body/copy.html', '<article>Saved body</article>')
    await expect(service.getBookmarkContent('text/body/copy.txt')).rejects.toThrow('Stored bookmark content is unavailable')
  })

  it('propagates HTML storage failures', async () => {
    const { bucket, service } = setup()
    await bucket.put('text/body/copy.txt', '')
    const get = bucket.get.bind(bucket)
    vi.spyOn(bucket, 'get').mockImplementation((...args) => {
      if (args[0] === 'html/body/copy.html') throw new Error('Storage unavailable')
      return get(...args)
    })
    await expect(service.getBookmarkContent('text/body/copy.txt')).rejects.toThrow('Storage unavailable')
  })
})
