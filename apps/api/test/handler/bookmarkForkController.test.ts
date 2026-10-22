import { describe, expect, it } from 'vitest'
import { BookmarkForkController } from '@/handler/http/bookmarkForkController'
import { forkError } from '@/utils/bookmarkForkError'
import { ErrorName } from '@slax-reader/contracts'

describe('Fork HTTP responses', () => {
  const ctx = {} as any
  it('uses real conflict status and no-store headers', async () => {
    const controller = new BookmarkForkController({
      fork: async () => {
        throw forkError()
      }
    } as any)
    const response = await controller.fork(ctx, new Request('https://api.test/v1/bookmark/fork', { method: 'POST', body: JSON.stringify({ source_user_bookmark_uuid: 'source' }) }))
    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ code: 409, data: 'fork_source_not_ready' })
  })
  it('returns only the public result contract', async () => {
    const controller = new BookmarkForkController({ fork: async () => ({ bookmark_id: 99, bookmark_uid: 'destination', disposition: 'created' }) } as any)
    const response = await controller.fork(ctx, new Request('https://api.test/v1/bookmark/fork', { method: 'POST', body: JSON.stringify({ source_user_bookmark_uuid: 'source' }) }))
    const body = (await response.json()) as any
    expect(body).toMatchObject({ code: 200, data: { bookmark_uid: 'destination', disposition: 'created' } })
    expect(body.data).not.toHaveProperty('bookmark_id')
  })
  it('rejects malformed JSON as 400 and uses 503 for transient copy failures', async () => {
    const controller = new BookmarkForkController({
      fork: async () => {
        throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      }
    } as any)
    const bad = await controller.fork(ctx, new Request('https://api.test/fork', { method: 'POST', body: 'bad' }))
    expect(bad.status).toBe(400)
    const failed = await controller.fork(ctx, new Request('https://api.test/fork', { method: 'POST', body: '{}' }))
    expect(failed.status).toBe(503)
  })
})
