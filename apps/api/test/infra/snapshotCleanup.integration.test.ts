import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { SnapshotCleanupRepo, publishSnapshot, retireSnapshot } from '@/infra/repository/dbSnapshotCleanup'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { UserDeletionService } from '@/domain/userDeletion'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { snapshotKeys } from '@/utils/snapshotBundle'

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('Snapshot cleanup ledger against PostgreSQL', () => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url })
  })
  const cleanup = new SnapshotCleanupRepo(() => client)
  const snapshots = new BookmarkForkRepo(() => client)
  const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), {
    prismaPg: () => client
  }) as BookmarkRepo
  const prefix = crypto.randomUUID()
  const key = () => snapshotKeys(prefix, crypto.randomUUID()).content_key
  const row = (bundle_key: string) => client.sr_snapshot_cleanup.findUnique({ where: { bundle_key } })
  const due = (bundle_key: string) =>
    client.sr_snapshot_cleanup.update({
      where: { bundle_key },
      data: { run_after: new Date(0) }
    })
  let userId: number
  beforeAll(async () => {
    userId = (
      await client.sr_user.create({
        data: {
          email: `${prefix}@cleanup.test`,
          created_at: new Date(),
          last_login_at: new Date()
        }
      })
    ).id
  })
  afterAll(async () => {
    await client.sr_bookmark.deleteMany({ where: { private_user: userId } })
    await client.sr_user.deleteMany({ where: { id: userId } })
    await client.sr_snapshot_cleanup.deleteMany({
      where: { bundle_key: { contains: prefix } }
    })
    await client.$disconnect()
  })
  async function raw(content_key = key()) {
    return client.sr_bookmark.create({
      data: {
        private_user: userId,
        target_url: `https://cleanup.test/${crypto.randomUUID()}`,
        content_key,
        content_md_key: content_key.replace('body.html', 'body.txt'),
        status: 'success',
        created_at: new Date(),
        updated_at: new Date(),
        published_at: new Date()
      }
    })
  }
  const content = (content_key: string) => ({
    content_key,
    content_md_key: content_key.replace('body.html', 'body.txt'),
    content_word_count: 1
  })

  it('registers once, with an immutable publication deadline well before cleanup eligibility', async () => {
    const bundle = key()
    await cleanup.registerBundle(bundle)
    const registered = (await row(bundle))!
    expect(registered.publish_until!.getTime() - registered.created_at.getTime()).toBeGreaterThan(290_000)
    expect(registered.run_after.getTime() - registered.publish_until!.getTime()).toBeGreaterThan(23 * 3600_000)
    await expect(cleanup.registerBundle(bundle)).rejects.toThrow()
    expect(await row(bundle)).toEqual(registered)
  })

  it('atomically publishes the next pointer and retires the previous bundle', async () => {
    const before = await raw()
    const next = key()
    await cleanup.registerBundle(next)
    expect(await snapshots.publishRevision(before.id, before.content_key, content(next))).toBe(true)
    expect(await row(next)).toBeNull()
    expect((await row(before.content_key))?.publish_until).toBeNull()
    expect((await snapshots.snapshot(before.id))?.content_key).toBe(next)
  })

  it('rolls back publication and keeps the old pointer if the attempt expired', async () => {
    const before = await raw()
    const next = key()
    await cleanup.registerBundle(next)
    await client.sr_snapshot_cleanup.update({
      where: { bundle_key: next },
      data: { publish_until: new Date(0) }
    })
    await expect(snapshots.publishRevision(before.id, before.content_key, content(next))).rejects.toThrow()
    expect((await snapshots.snapshot(before.id))?.content_key).toBe(before.content_key)
    expect(await row(before.content_key)).toBeNull()
    expect(await row(next)).not.toBeNull()
  })

  it('serializes a publisher against cleanup claiming the same bundle', async () => {
    const bundle = key()
    await cleanup.registerBundle(bundle)
    await due(bundle)
    let unlock!: () => void
    const held = new Promise<void>(resolve => {
      unlock = resolve
    })
    let locked!: () => void
    const started = new Promise<void>(resolve => {
      locked = resolve
    })
    const publishing = client.$transaction(async tx => {
      await publishSnapshot(tx, bundle)
      locked()
      await held
    })
    await started
    try {
      expect((await cleanup.claim()).some(job => job.bundle_key === bundle)).toBe(false)
    } finally {
      unlock()
    }
    await publishing
    expect(await row(bundle)).toBeNull()

    const loser = key()
    await cleanup.registerBundle(loser)
    await due(loser)
    const claim = (await cleanup.claim()).find(job => job.bundle_key === loser)!
    expect(claim).toBeDefined()
    await expect(client.$transaction(tx => publishSnapshot(tx, loser))).rejects.toThrow()
    expect(await row(loser)).not.toBeNull()
  })

  it('keeps rollback candidates and fences acknowledgement after a lease is reclaimed', async () => {
    const bundle = key()
    await cleanup.registerBundle(bundle)
    await expect(
      client.$transaction(async tx => {
        await publishSnapshot(tx, bundle)
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect(await row(bundle)).not.toBeNull()
    await due(bundle)
    const first = (await cleanup.claim()).find(job => job.bundle_key === bundle)!
    await due(bundle)
    const second = (await cleanup.claim()).find(job => job.bundle_key === bundle)!
    expect(second.lease_token).not.toBe(first.lease_token)
    await cleanup.acknowledge(first)
    expect(await row(bundle)).not.toBeNull()
    await cleanup.acknowledge(second)
    expect(await row(bundle)).toBeNull()
  })

  it('finds references through either pointer and enqueues permanent deletion atomically', async () => {
    const before = await raw()
    expect(await cleanup.referenced([before.content_md_key])).toContain(before.content_md_key)
    expect(await bookmarks.deleteBookmarkTry(before.id, userId + 1)).toBeNull()
    expect(await row(before.content_key)).toBeNull()
    expect(await bookmarks.deleteBookmarkTry(before.id, userId)).toMatchObject({
      id: before.id
    })
    expect((await row(before.content_key))?.publish_until).toBeNull()
    expect(await snapshots.snapshot(before.id)).toBeNull()
  })

  it('rolls back retirement if the owning pointer transaction fails and rejects retired publication', async () => {
    const before = await raw()
    await expect(
      client.$transaction(async tx => {
        await retireSnapshot(tx, before.content_key)
        await tx.sr_bookmark.delete({ where: { id: before.id } })
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect(await row(before.content_key)).toBeNull()
    expect(await snapshots.snapshot(before.id)).not.toBeNull()
    await client.$transaction(tx => retireSnapshot(tx, before.content_key))
    await expect(client.$transaction(tx => publishSnapshot(tx, before.content_key))).rejects.toThrow()
  })

  it('retires a PDF Fork when independent PDF acquisition switches to legacy storage', async () => {
    const before = await raw(`pdf/body/forks/${prefix}/${crypto.randomUUID()}.pdf`)
    await bookmarks.completePdfBookmark(before.id, { status: 'success', content_key: 'pdf/body/new.pdf' }, 'document')
    expect(await row(before.content_key)).not.toBeNull()
  })

  it('registers all managed bundles removed by account deletion, preserving another owner', async () => {
    const owner = (
      await client.sr_user.create({
        data: {
          email: `${crypto.randomUUID()}@cleanup.test`,
          created_at: new Date(),
          last_login_at: new Date()
        }
      })
    ).id
    const kept = await raw()
    const removed = await raw()
    await client.sr_bookmark.update({
      where: { id: removed.id },
      data: { private_user: owner }
    })
    try {
      const service = new UserDeletionService(() => client, {} as never)
      await (service as any).deletePrivateBookmarks(owner)
      expect(await row(removed.content_key)).not.toBeNull()
      expect(await snapshots.snapshot(removed.id)).toBeNull()
      expect(await snapshots.snapshot(kept.id)).not.toBeNull()
      expect(await row(kept.content_key)).toBeNull()
    } finally {
      await client.sr_user.delete({ where: { id: owner } })
    }
  })

  it('bounds concurrent cron claims and does not hand the same task to both workers', async () => {
    const keys = Array.from({ length: 105 }, key)
    await client.sr_snapshot_cleanup.createMany({
      data: keys.map(bundle_key => ({ bundle_key, run_after: new Date(0) }))
    })
    const [a, b] = await Promise.all([cleanup.claim(), cleanup.claim()])
    expect(a.length).toBeLessThanOrEqual(100)
    expect(b.length).toBeLessThanOrEqual(100)
    const selected = [...a, ...b].filter(job => keys.includes(job.bundle_key))
    expect(selected).toHaveLength(105)
    expect(new Set(selected.map(job => job.bundle_key)).size).toBe(105)
  })
})
