import { describe, expect, it, vi } from 'vitest'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'

describe('Fork source sharing access', () => {
  const cases = [
    { name: 'global sharing disabled', sharing: false, share: null, allowed: false },
    { name: 'global sharing enabled', sharing: true, share: null, allowed: true },
    { name: 'explicit sharing overrides disabled default', sharing: false, share: { is_enable: true }, allowed: true },
    { name: 'explicit restriction overrides enabled default', sharing: true, share: { is_enable: false }, allowed: false }
  ]

  describe.each([0, 2])('viewer %i', viewer => {
    it.each(cases)('$name applies to source and provenance lookups', async ({ sharing, share, allowed }) => {
      const relation = { id: 11, uuid: 'source', user_id: 1, bookmark_id: 10, deleted_at: null, bookmark: { moderation_result: 0 } }
      const db = {
        sr_user_bookmark: { findUnique: vi.fn().mockResolvedValue(relation) },
        sr_user: { findUnique: vi.fn().mockResolvedValue({ id: 1, snapshot_sharing: sharing, deleted_at: null }) },
        sr_bookmark_share: { findUnique: vi.fn().mockResolvedValue(share) }
      }
      const repo = new BookmarkForkRepo(() => db as never)

      for (const result of [await repo.source(viewer, relation.uuid), await repo.sourceById(viewer, relation.id)]) {
        if (allowed) expect(result?.id).toBe(relation.id)
        else expect(result).toBeNull()
      }
    })
  })
})
