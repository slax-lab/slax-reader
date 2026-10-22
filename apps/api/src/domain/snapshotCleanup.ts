import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { MediaSnapshotService } from './mediaSnapshot'
import { snapshotBundleMembers, SNAPSHOT_CLEANUP_GRACE_MS } from '@/utils/snapshotBundle'
import type { ContextManager } from '@/utils/context'

@injectable()
export class SnapshotCleanupService {
  constructor(
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(BookmarkForkRepo) private repo: BookmarkForkRepo,
    @inject(MediaSnapshotService) private media: MediaSnapshotService
  ) {}

  /** One bounded page per prefix. A failed authoritative read never becomes evidence of an orphan. */
  async sweepObjects(ctx: ContextManager, prefix: string) {
    const cursorKey = `snapshot-cleanup:${prefix}:cursor`
    const cursor = (await ctx.env.KV.get(cursorKey)) || undefined
    const page = await this.bucket().R2Bucket.list({ prefix, cursor, limit: 100, include: ['customMetadata'] })
    const visited = new Set<string>()
    for (const object of page.objects) {
      const members = snapshotBundleMembers(object.key)
      const meta = object.customMetadata
      const created = Number(meta?.snapshot_created)
      if (!members || !meta?.snapshot_owner || !meta.snapshot_attempt || !Number.isFinite(created) || created <= 0) continue
      if (!object.key.includes(`/${meta.snapshot_owner}/${meta.snapshot_attempt}/`) && !object.key.includes(`/${meta.snapshot_owner}/${meta.snapshot_attempt}.`)) continue
      if (Date.now() - Math.max(created, object.uploaded.getTime()) < SNAPSHOT_CLEANUP_GRACE_MS || visited.has(members[0])) continue
      visited.add(members[0])
      if (!(await this.repo.referenced(members))) await this.bucket().R2Bucket.delete(members)
    }
    await ctx.env.KV.put(cursorKey, page.truncated ? page.cursor : '')
  }

  async sweep(ctx: ContextManager) {
    for (const prefix of ['snapshots/', 'pdf/body/forks/', 'pdf/meta/forks/', 'text/pdf/forks/']) await this.sweepObjects(ctx, prefix)
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
