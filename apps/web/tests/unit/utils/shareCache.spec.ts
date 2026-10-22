import { canUseVisitorCache, matchesCurrentSnapshot, SNAPSHOT_REVISION_HEADER, snapshotMetadataRevision } from '../../../server/utils/shareCache'

import { describe, expect, it, vi } from 'vitest'

describe('share visitor cache identity', () => {
  it('lets anonymous and known non-owner visitors use the visitor cache', () => {
    expect(canUseVisitorCache('', null)).toBe(true)
    expect(canUseVisitorCache('viewer-2', 'owner-1')).toBe(true)
  })

  it('keeps the owner out of the visitor cache', () => {
    expect(canUseVisitorCache('owner-1', 'owner-1')).toBe(false)
  })

  it('bypasses legacy visitor entries without an owner id for logged-in users', () => {
    expect(canUseVisitorCache('viewer-2', null)).toBe(false)
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
