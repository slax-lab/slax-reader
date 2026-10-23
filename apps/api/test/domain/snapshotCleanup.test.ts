import { describe, expect, it, vi } from 'vitest'
import { SnapshotCleanupService } from '@/domain/snapshotCleanup'

function fixture() {
  const claims = ['live', 'orphan', 'pdf'].map(name => ({
    bundle_key: name === 'pdf' ? 'pdf/body/forks/user/attempt.pdf' : `snapshots/user/${name}/body.html`,
    lease_token: 'claim'
  }))
  const bucket = {
    list: vi.fn(() => {
      throw new Error('R2 listing is forbidden')
    }),
    delete: vi.fn()
  }
  const cleanup = {
    claim: vi.fn(async () => claims),
    referenced: vi.fn(async () => new Set([claims[0].bundle_key])),
    acknowledge: vi.fn()
  }
  const service = Object.assign(Object.create(SnapshotCleanupService.prototype), { bucket: () => ({ R2Bucket: bucket }), cleanup }) as SnapshotCleanupService
  return { service, cleanup, bucket, claims }
}

describe('registered snapshot cleanup', () => {
  it('checks one batch and deletes only unreferenced complete bundles without listing R2', async () => {
    const { service, cleanup, bucket } = fixture()
    await service.sweepObjects()
    expect(cleanup.referenced).toHaveBeenCalledTimes(1)
    expect(bucket.list).not.toHaveBeenCalled()
    expect(bucket.delete.mock.calls).toEqual([
      [['snapshots/user/orphan/body.html', 'snapshots/user/orphan/body.txt', 'snapshots/user/orphan/media.json']],
      [['pdf/body/forks/user/attempt.pdf', 'text/pdf/forks/user/attempt.txt', 'pdf/meta/forks/user/attempt.json']]
    ])
    expect(cleanup.acknowledge).toHaveBeenCalledTimes(3)
  })

  it('retains all claims and objects on uncertain reference lookup', async () => {
    const { service, cleanup, bucket } = fixture()
    cleanup.referenced.mockRejectedValue(new Error('database unavailable'))
    await expect(service.sweepObjects()).rejects.toThrow('database unavailable')
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(cleanup.acknowledge).not.toHaveBeenCalled()
  })

  it('keeps a failed deletion retryable while processing other claims', async () => {
    const { service, cleanup, bucket, claims } = fixture()
    bucket.delete.mockRejectedValueOnce(new Error('R2 unavailable'))
    await service.sweepObjects()
    expect(cleanup.acknowledge.mock.calls).toEqual([[claims[0]], [claims[2]]])
  })

  it('can repeat deletion after an acknowledgement is lost', async () => {
    const { service, cleanup, bucket, claims } = fixture()
    cleanup.claim.mockResolvedValue([claims[1]])
    cleanup.acknowledge.mockRejectedValueOnce(new Error('ack lost'))
    await service.sweepObjects()
    await service.sweepObjects()
    expect(bucket.delete).toHaveBeenCalledTimes(2)
    expect(cleanup.acknowledge).toHaveBeenCalledTimes(2)
  })

  it('keeps malformed candidates without attempting an arbitrary object deletion', async () => {
    const { service, cleanup, bucket } = fixture()
    cleanup.claim.mockResolvedValue([{ bundle_key: 'private/unrelated', lease_token: 'bad' }])
    await service.sweepObjects()
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(cleanup.acknowledge).not.toHaveBeenCalled()
  })
})
