import { describe, expect, it, vi } from 'vitest'
import { SnapshotCleanupService } from '@/domain/snapshotCleanup'
import { SNAPSHOT_CLEANUP_GRACE_MS } from '@/utils/snapshotBundle'

describe('snapshot orphan cleanup', () => {
  it('keeps recent attempts, referenced bundles and objects without trustworthy ownership', async () => {
    const old = String(Date.now() - SNAPSHOT_CLEANUP_GRACE_MS - 60_000)
    const object = (attempt: string, created = old) => ({
      key: `snapshots/user/${attempt}/media.json`,
      uploaded: new Date(Number(created)),
      customMetadata: { snapshot_owner: 'user', snapshot_attempt: attempt, snapshot_created: created }
    })
    const remove = vi.fn()
    const service = Object.assign(Object.create(SnapshotCleanupService.prototype), {
      bucket: () => ({
        R2Bucket: {
          list: vi.fn(async () => ({
            objects: [object('live'), object('unknown-commit', String(Date.now())), object('orphan'), { key: 'snapshots/legacy/old/body.html' }],
            truncated: false
          })),
          delete: remove
        }
      }),
      repo: { referenced: vi.fn(async (keys: string[]) => keys.some(key => key.includes('/live/'))) }
    }) as SnapshotCleanupService
    const ctx = { env: { KV: { get: vi.fn(async () => null), put: vi.fn() } } } as any
    await service.sweepObjects(ctx, 'snapshots/')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(['snapshots/user/orphan/body.html', 'snapshots/user/orphan/body.txt', 'snapshots/user/orphan/media.json'])
  })

  it('retains all objects when reference lookup is unavailable', async () => {
    const remove = vi.fn()
    const old = Date.now() - SNAPSHOT_CLEANUP_GRACE_MS - 60_000
    const service = Object.assign(Object.create(SnapshotCleanupService.prototype), {
      bucket: () => ({
        R2Bucket: {
          list: vi.fn(async () => ({
            objects: [{ key: 'snapshots/u/a/body.html', uploaded: new Date(old), customMetadata: { snapshot_owner: 'u', snapshot_attempt: 'a', snapshot_created: String(old) } }],
            truncated: false
          })),
          delete: remove
        }
      }),
      repo: {
        referenced: vi.fn(async () => {
          throw new Error('offline')
        })
      }
    }) as SnapshotCleanupService
    await expect(service.sweepObjects({ env: { KV: { get: vi.fn(async () => null) } } } as any, 'snapshots/')).rejects.toThrow('offline')
    expect(remove).not.toHaveBeenCalled()
  })
})
