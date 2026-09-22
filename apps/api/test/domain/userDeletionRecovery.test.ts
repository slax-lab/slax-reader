import { describe, expect, test, vi } from 'vitest'
import { UserDeletionJob } from '@/handler/cron/userDeletionJob'

const harness = () => {
  const deleted_at = new Date('2026-09-18T00:00:00Z')
  const values = new Map<string, string>()
  const get = vi.fn(async (key: string) => values.get(key) ?? null)
  const put = vi.fn(async (key: string, value: string) => void values.set(key, value))
  const cleanupUserData = vi.fn().mockResolvedValue(undefined)
  const revokeUser = vi.fn().mockResolvedValue(undefined)
  const prisma = { sr_user: { findMany: vi.fn().mockResolvedValue([{ id: 1, deleted_at }]) } }
  const job = new UserDeletionJob(() => prisma as never, { cleanupUserData } as never)
  const ctx = { env: { KV: { get, put }, WEBSOCKET_SERVER: { idFromName: () => 'global', get: () => ({ revokeUser }) } } } as never
  return { job, ctx, prisma, values, cleanupUserData, revokeUser, deleted_at }
}

describe('deleted-account cleanup recovery', () => {
  test('reconstructs lost queue work from durable tombstones', async () => {
    const h = harness()
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.revokeUser).toHaveBeenCalledWith(1)
    expect(h.cleanupUserData).toHaveBeenCalledWith(1)
    expect(h.values.get(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe('1')
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledOnce()
  })

  test('retries failures on later scans without starving subsequent accounts', async () => {
    const h = harness()
    h.prisma.sr_user.findMany.mockResolvedValue([
      { id: 1, deleted_at: h.deleted_at },
      { id: 2, deleted_at: h.deleted_at }
    ])
    h.cleanupUserData.mockRejectedValueOnce(new Error('temporary database failure'))
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledWith(2)
    expect(h.values.has(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe(false)
    expect(h.values.get(`user-deletion-recovery:done:2:${h.deleted_at.getTime()}`)).toBe('1')
    await h.job.recoverDeletedUsers(h.ctx)
    expect(h.cleanupUserData).toHaveBeenCalledTimes(3)
    expect(h.values.get(`user-deletion-recovery:done:1:${h.deleted_at.getTime()}`)).toBe('1')
  })
})
