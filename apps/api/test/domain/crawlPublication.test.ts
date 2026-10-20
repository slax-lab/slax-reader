import { describe, expect, test, vi } from 'vitest'
import { CrawlService } from '@/domain/crawl'
import { createMockCtx } from '@test/helpers/mockFactory'

const article = {
  url: 'https://example.com/article',
  title: 'New article',
  content:
    '<html><head><title>New article</title></head><body><article><p>A complete new article replaces the previous saved snapshot only after both objects are written.</p></article></body></html>'
}

function setup(publish = true) {
  const objects = new Map<string, string>()
  const bucket = {
    putIfKeyExists: vi.fn(async (key: string, body: string) => {
      objects.set(key, body)
    }),
    R2Bucket: {
      delete: vi.fn(async (keys: string[]) => {
        for (const key of keys) objects.delete(key)
      })
    }
  }
  const repo = { updateBookmark: vi.fn(), stageBookmarkObjects: vi.fn().mockResolvedValue(undefined), publishBookmarkVersion: vi.fn().mockResolvedValue(publish) }
  const service = new CrawlService(() => bucket as any, repo as any, {} as any, {} as any, {} as any, {} as any, {} as any)
  return { service, repo, bucket, objects }
}

describe('crawl content publication', () => {
  test('stages destination version keys before publishing instead of replacing the live UUID objects', async () => {
    const { service, repo, objects } = setup()
    repo.publishBookmarkVersion.mockImplementation(async (_id, _version, data) => {
      expect(objects.get(data.content_key)).toContain('complete new article')
      expect(objects.get(data.content_md_key)).toContain('complete new article')
      return true
    })
    await service.parseAndSaveContent(createMockCtx(), article, 42, { uuid: 'target-uuid', writeVersion: 3 } as any)
    expect(repo.publishBookmarkVersion).toHaveBeenCalledWith(42, 3, expect.objectContaining({ status: 'success' }))
    expect(repo.updateBookmark).not.toHaveBeenCalled()
    expect([...objects.keys()]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^html\/body\/target-uuid\/3\/[a-f0-9-]+\.html$/), expect.stringMatching(/^text\/body\/target-uuid\/3\/[a-f0-9-]+\.txt$/)])
    )
    expect(objects.has('html/body/target-uuid.html')).toBe(false)
  })

  test('legacy queue writers also stage unique revision keys without mutating a committed UUID body', async () => {
    const { service, repo, objects } = setup()
    objects.set('html/body/target-uuid.html', 'previous body')
    objects.set('text/body/target-uuid.txt', 'previous text')
    await service.parseAndSaveContent(createMockCtx(), article, 42, 'target-uuid')
    const first = repo.publishBookmarkVersion.mock.calls[0][2] as any
    await service.parseAndSaveContent(createMockCtx(), article, 42, 'target-uuid')
    const second = repo.publishBookmarkVersion.mock.calls[1][2] as any
    expect(first.content_key).not.toBe(second.content_key)
    expect(first.content_key).toMatch(/^html\/body\/target-uuid\/0\/[a-f0-9-]+\.html$/)
    expect(repo.stageBookmarkObjects).toHaveBeenCalledWith(42, 0, first.content_key, [first.content_key, first.content_md_key])
    expect(repo.publishBookmarkVersion).toHaveBeenCalledWith(42, 0, expect.any(Object))
    expect(objects.get('html/body/target-uuid.html')).toBe('previous body')
    expect(objects.get('text/body/target-uuid.txt')).toBe('previous text')
    expect(repo.updateBookmark).not.toHaveBeenCalled()
  })

  test('a superseded crawl removes only its staged objects and signals that post-processing must stop', async () => {
    const { service, repo, objects } = setup(false)
    await expect(service.parseAndSaveContent(createMockCtx(), article, 42, { uuid: 'target-uuid', writeVersion: 3 } as any)).rejects.toThrow('superseded')
    expect(objects.size).toBe(0)
    expect(repo.updateBookmark).not.toHaveBeenCalled()
  })

  test('a sidecar write failure never publishes a partial version', async () => {
    const { service, repo, bucket } = setup()
    bucket.putIfKeyExists.mockRejectedValueOnce(new Error('R2 unavailable'))
    await expect(service.parseAndSaveContent(createMockCtx(), article, 42, { uuid: 'target-uuid', writeVersion: 3 } as any)).rejects.toThrow('R2 unavailable')
    expect(repo.publishBookmarkVersion).not.toHaveBeenCalled()
    expect(repo.updateBookmark).not.toHaveBeenCalled()
  })
})
