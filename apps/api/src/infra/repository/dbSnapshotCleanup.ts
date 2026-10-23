import { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { snapshotBundleMembers, SNAPSHOT_PUBLICATION_MS, SNAPSHOT_CLEANUP_GRACE_MS } from '@/utils/snapshotBundle'
import { forkError } from '@/utils/bookmarkForkError'

export type SnapshotCleanupClaim = { bundle_key: string; lease_token: string }
const RETRY_MS = 5 * 60_000

/** Called inside the pointer transaction. Claiming and publishing serialize on this row. */
export async function publishSnapshot(db: Prisma.TransactionClient, key: string) {
  if (!key) return // Bodyless shortcuts have no storage registration.
  const members = snapshotBundleMembers(key)
  if (!members || members[0] !== key) throw forkError()
  const deleted = await db.$executeRaw`
    DELETE FROM sr_snapshot_cleanup
    WHERE bundle_key = ${key} AND lease_token IS NULL AND publish_until > clock_timestamp()`
  if (deleted !== 1) throw forkError()
}

/** Retirement is committed or rolled back together with removal of the last owned pointer. */
export async function retireSnapshot(db: Prisma.TransactionClient, key: string) {
  const members = snapshotBundleMembers(key)
  if (!members) return // Mutable legacy keys retain their existing lifecycle.
  await db.$executeRaw`
    INSERT INTO sr_snapshot_cleanup (bundle_key, run_after)
    VALUES (${members[0]}, clock_timestamp() + ${SNAPSHOT_CLEANUP_GRACE_MS} * interval '1 millisecond')
    ON CONFLICT (bundle_key) DO UPDATE SET
      publish_until = NULL, lease_token = NULL, run_after = EXCLUDED.run_after`
}

@injectable()
export class SnapshotCleanupRepo {
  constructor(
    @inject(PRISIMA_HYPERDRIVE_CLIENT)
    private client: LazyInstance<PrismaClient>
  ) {}

  async registerBundle(key: string) {
    if (snapshotBundleMembers(key)?.[0] !== key) throw forkError()
    // Insert only: no attempt may reset its publication deadline or revive a retired bundle.
    await this.client().$executeRaw`
      INSERT INTO sr_snapshot_cleanup (bundle_key, publish_until, run_after)
      VALUES (${key}, clock_timestamp() + ${SNAPSHOT_PUBLICATION_MS} * interval '1 millisecond',
        clock_timestamp() + ${SNAPSHOT_CLEANUP_GRACE_MS} * interval '1 millisecond')`
  }

  async claim(): Promise<SnapshotCleanupClaim[]> {
    const token = crypto.randomUUID()
    return this.client().$queryRaw`
      WITH due AS (
        SELECT bundle_key FROM sr_snapshot_cleanup
        WHERE run_after <= CURRENT_TIMESTAMP
        ORDER BY run_after LIMIT 100 FOR UPDATE SKIP LOCKED
      )
      UPDATE sr_snapshot_cleanup AS job SET lease_token = ${token},
        run_after = clock_timestamp() + ${RETRY_MS} * interval '1 millisecond'
      FROM due WHERE job.bundle_key = due.bundle_key
      RETURNING job.bundle_key, job.lease_token`
  }

  async referenced(keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set()
    const rows = await this.client().sr_bookmark.findMany({
      where: {
        OR: [{ content_key: { in: keys } }, { content_md_key: { in: keys } }]
      },
      select: { content_key: true, content_md_key: true }
    })
    return new Set(rows.flatMap(row => [row.content_key, row.content_md_key]))
  }

  async acknowledge(claim: SnapshotCleanupClaim) {
    await this.client().sr_snapshot_cleanup.deleteMany({ where: claim })
  }
}
