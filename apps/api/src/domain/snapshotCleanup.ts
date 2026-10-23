import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { MediaSnapshotService } from './mediaSnapshot'
import { snapshotBundleMembers } from '@/utils/snapshotBundle'
import { SnapshotCleanupRepo } from '@/infra/repository/dbSnapshotCleanup'
import type { ContextManager } from '@/utils/context'

@injectable()
export class SnapshotCleanupService {
  constructor(
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(BookmarkForkRepo) private repo: BookmarkForkRepo,
    @inject(MediaSnapshotService) private media: MediaSnapshotService,
    @inject(SnapshotCleanupRepo) private cleanup: SnapshotCleanupRepo
  ) {}

  /** No bucket listing. Failed/unfinished claims become due again after their short lease. */
  async sweepObjects() {
    const claims = await this.cleanup.claim()
    const referenced = await this.cleanup.referenced(claims.flatMap(claim => snapshotBundleMembers(claim.bundle_key) ?? []))
    for (const claim of claims) {
      try {
        const members = snapshotBundleMembers(claim.bundle_key)
        if (!members || members[0] !== claim.bundle_key) throw new Error('Invalid snapshot cleanup key')
        if (!members.some(key => referenced.has(key))) await this.bucket().R2Bucket.delete(members)
        await this.cleanup.acknowledge(claim)
      } catch (error) {
        console.error('Snapshot cleanup deferred', {
          bundleKey: claim.bundle_key,
          error
        })
      }
    }
  }

  async sweep(ctx: ContextManager) {
    await this.sweepObjects().catch(error => console.error('Snapshot cleanup deferred', error))
    const cursorKey = 'snapshot-settlement:cursor'
    const value = Number(await ctx.env.KV.get(cursorKey))
    const cursor = Number.isSafeInteger(value) && value > 0 ? value : 0
    const snapshots = await this.repo.listSnapshots(cursor, 25)
    for (const snapshot of snapshots) {
      try {
        await this.media.settle(ctx, snapshot.id)
        await this.media.repairIndex(ctx, snapshot.id)
      } catch (error) {
        console.error('Private snapshot settlement deferred', { bookmarkId: snapshot.id, error })
      }
    }
    await ctx.env.KV.put(cursorKey, snapshots.length === 25 ? String(snapshots[snapshots.length - 1].id) : '0')
  }
}
