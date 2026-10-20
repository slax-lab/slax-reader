import { describe, expect, it, vi } from 'vitest'
import { BucketClient } from '@/infra/repository/bucketClient'

describe('R2 copy helpers', () => {
  it('persists an empty text sidecar so image-only articles remain copyable', async () => {
    const put = vi.fn().mockResolvedValue({ key: 'text/body/image-only.txt' })
    const client = new BucketClient({ OSS: { put } } as any)
    await client.putIfKeyExists('text/body/image-only.txt', '')
    expect(put).toHaveBeenCalledExactlyOnceWith('text/body/image-only.txt', '')
    await client.putIfKeyExists('', '')
    await client.putIfKeyExists('unused', undefined)
    expect(put).toHaveBeenCalledOnce()
  })

  it('streams the exact body and preserves HTTP/custom metadata', async () => {
    const body = new Blob(['snapshot']).stream()
    const object = { body, httpMetadata: { contentType: 'text/html' }, customMetadata: { source: 'capture' }, arrayBuffer: vi.fn() }
    const put = vi.fn().mockResolvedValue({ key: 'destination' })
    const client = new BucketClient({ OSS: { get: vi.fn().mockResolvedValue(object), put } } as any)
    await client.copyObject('source', 'destination')
    expect(put).toHaveBeenCalledWith('destination', body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })
    expect(object.arrayBuffer).not.toHaveBeenCalled()
  })

  it('cleans successfully staged objects when a later source is missing', async () => {
    const objects = new Map([['source', 'article']])
    const bucket = {
      get: async (key: string) => (objects.has(key) ? { body: new Blob([objects.get(key)!]).stream() } : null),
      put: async (key: string, body: ReadableStream) => {
        objects.set(key, await new Response(body).text())
        return { key }
      },
      delete: async (key: string) => {
        objects.delete(key)
      }
    }
    const client = new BucketClient({ OSS: bucket } as any)
    await expect(
      client.copyObjects([
        { sourceKey: 'source', destinationKey: 'new-body' },
        { sourceKey: 'missing', destinationKey: 'new-text' }
      ])
    ).rejects.toThrow()
    expect([...objects.keys()]).toEqual(['source'])
  })
})
