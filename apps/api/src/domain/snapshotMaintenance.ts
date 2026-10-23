import { inject, injectable } from '@/decorators/di'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { MediaSnapshotService } from './mediaSnapshot'
import type { ContextManager } from '@/utils/context'

@injectable()
export class SnapshotMaintenanceService {
  constructor(
    @inject(BookmarkForkRepo) private repo: BookmarkForkRepo,
    @inject(MediaSnapshotService) private media: MediaSnapshotService
  ) {}

  async maintain(ctx: ContextManager) {
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
