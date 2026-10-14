/**
 * PowerSync write path: tags created through sync are "mine", links added through
 * sync are "user" and bump recency, auto-hide only touches auto tags of this user.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?')

function makeTx() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    sr_user_tag: { upsert: vi.fn().mockResolvedValue(undefined) }
  }
}

describe('executeCreateTag', () => {
  test('marks the tag as mine on create and on conflict', async () => {
    const op = new (DBSyncBatchOperation as any)(() => null) as DBSyncBatchOperation
    const tx = makeTx()

    await op.executeCreateTag(tx as any, { type: 'create_tag', userId: 1, tagUuid: 'u1', data: { tagName: '创业' } } as any)

    const arg = tx.sr_user_tag.upsert.mock.calls[0][0]
    expect(arg.create).toMatchObject({ tag_name: '创业', uuid: 'u1', source: 'mine', display: true })
    expect(arg.update).toMatchObject({ source: 'mine', display: true })
  })
})

describe('executeUpdateTags', () => {
  test('adds links as user and bumps last_used_at', async () => {
    const op = new (DBSyncBatchOperation as any)(() => null) as DBSyncBatchOperation
    const tx = makeTx()

    await op.executeUpdateTags(tx as any, {
      type: 'update_tags',
      userId: 1,
      bookmarkUuid: 'b1',
      data: { tagsToAdd: ['u1'], tagsToDelete: [] }
    } as any)

    const [insert, touch] = tx.$executeRaw.mock.calls.map(sqlOf)
    expect(insert).toContain('is_deleted, created_at, source)')
    expect(insert).toContain("'user'")
    expect(insert).toContain("DO UPDATE SET is_deleted = false, source = 'user'")
    expect(touch).toContain('SET display = true, last_used_at = NOW()')
  })

  test('auto-hide after delete is scoped to auto tags of this user', async () => {
    const op = new (DBSyncBatchOperation as any)(() => null) as DBSyncBatchOperation
    const tx = makeTx()

    await op.executeUpdateTags(tx as any, {
      type: 'update_tags',
      userId: 1,
      bookmarkUuid: 'b1',
      data: { tagsToAdd: [], tagsToDelete: ['u1'] }
    } as any)

    const [softDelete, hide] = tx.$executeRaw.mock.calls.map(sqlOf)
    expect(softDelete).toContain('SET is_deleted = true')
    expect(hide).toContain("t.source = 'auto'")
    expect(hide).toContain('bt.user_id = t.user_id')
  })
})
