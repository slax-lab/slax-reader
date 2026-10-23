import { describe, expect, it, vi } from 'vitest'
import { SnapshotMaintenanceService } from '@/domain/snapshotMaintenance'

describe('private snapshot maintenance', () => {
  it('continues after one settlement failure and advances the bounded scan', async () => {
    const repo = { listSnapshots: vi.fn(async () => Array.from({ length: 25 }, (_, i) => ({ id: i + 51 }))) }
    const media = {
      settle: vi.fn(async (_ctx, id: number) => {
        if (id === 51) throw new Error('Temporary failure')
      }),
      repairIndex: vi.fn(async () => {})
    }
    const KV = { get: vi.fn(async () => '50'), put: vi.fn(async () => {}) }
    const ctx = { env: { KV } } as any
    await new SnapshotMaintenanceService(repo as any, media as any).maintain(ctx)
    expect(repo.listSnapshots).toHaveBeenCalledWith(50, 25)
    expect(media.settle).toHaveBeenCalledTimes(25)
    expect(media.repairIndex).toHaveBeenCalledTimes(24)
    expect(media.repairIndex).toHaveBeenLastCalledWith(ctx, 75)
    expect(KV.put).toHaveBeenCalledWith('snapshot-settlement:cursor', '75')
  })

  it('restarts the scan after reaching the last page', async () => {
    const repo = { listSnapshots: vi.fn(async () => []) }
    const KV = { get: vi.fn(async () => '75'), put: vi.fn(async () => {}) }
    await new SnapshotMaintenanceService(repo as any, {} as any).maintain({ env: { KV } } as any)
    expect(KV.put).toHaveBeenCalledWith('snapshot-settlement:cursor', '0')
  })
})
