import { hasSnapshotCredentials, matchesCurrentSnapshot, SNAPSHOT_REVISION_HEADER, snapshotMetadataRevision } from '../../../server/utils/shareCache'

import { createEvent } from 'h3'
import { describe, expect, it, vi } from 'vitest'

describe('shared cache credential boundary', () => {
  it.each([{ cookie: 'token=invalid' }, { cookie: 'token=' }, { authorization: 'Bearer expired' }, { authorization: '' }])('bypasses shared cache for any credential: %j', headers => {
    const event = createEvent({ headers } as never, {} as never)
    expect(hasSnapshotCredentials(event, 'token')).toBe(true)
  })
  it('keeps anonymous requests and unrelated cookies eligible', () => {
    const event = createEvent({ headers: { cookie: 'theme=dark' } } as never, {} as never)
    expect(hasSnapshotCredentials(event, 'token')).toBe(false)
  })
})

describe('cached snapshot authorization and revision', () => {
  const metadata = {
    role: 'visitor',
    content_key: 'snapshots/owner/revision/body.html',
    user_info: { show_userinfo: true }
  }
  const cached = async () =>
    new Response('Saved HTML', {
      headers: {
        [SNAPSHOT_REVISION_HEADER]: await snapshotMetadataRevision(metadata)
      }
    })

  it('revalidates current access even when a cached body exists', async () => {
    for (const status of [401, 403, 404, 503]) {
      const backend = {
        fetch: vi.fn(async () => new Response(null, { status }))
      }
      expect(await matchesCurrentSnapshot(await cached(), backend, 'snapshot', 'token', 'visitor')).toBe(false)
      expect(backend.fetch).toHaveBeenCalledWith('https://content.internal/content/meta?uuid=snapshot', { headers: { Authorization: 'Bearer token' } })
    }
  })

  it('misses on policy/body, identity-visibility or role changes; old entries cannot bypass the check', async () => {
    for (const current of [
      { ...metadata, content_key: 'snapshots/owner/removed/body.html' },
      { ...metadata, user_info: { show_userinfo: false } },
      { ...metadata, role: 'owner' }
    ]) {
      expect(await matchesCurrentSnapshot(await cached(), { fetch: async () => Response.json(current) }, 'snapshot', undefined, 'visitor')).toBe(false)
    }
    expect(await matchesCurrentSnapshot(new Response('Old cache'), { fetch: async () => Response.json(metadata) }, 'snapshot', undefined, 'visitor')).toBe(false)
    expect(await matchesCurrentSnapshot(await cached(), { fetch: async () => Response.json(metadata) }, 'snapshot', undefined, 'visitor')).toBe(true)
  })
})
