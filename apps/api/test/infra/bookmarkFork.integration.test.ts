import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { podcastInputFingerprint } from '@/utils/mediaSnapshot'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('Fork publication against PostgreSQL', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const repo = new BookmarkForkRepo(() => client)
  const users: number[] = []
  const raws: number[] = []
  let source: Awaited<ReturnType<BookmarkForkRepo['source']>>
  beforeAll(async () => {
    for (const name of ['source', 'destination']) {
      const user = await client.sr_user.create({ data: { email: `${crypto.randomUUID()}@fork.test`, name, created_at: new Date(), last_login_at: new Date() } })
      users.push(user.id)
    }
    const bookmark = await client.sr_bookmark.create({
      data: {
        title: 'Original title',
        target_url: `https://example.com/${crypto.randomUUID()}`,
        private_user: users[0],
        status: 'success',
        content_key: 'source.html',
        content_md_key: 'source.txt',
        created_at: new Date(),
        updated_at: new Date(),
        published_at: new Date()
      }
    })
    raws.push(bookmark.id)
    const relation = await client.sr_user_bookmark.create({
      data: { user_id: users[0], bookmark_id: bookmark.id, updated_at: new Date(), alias_title: 'Personal alias', is_starred: true }
    })
    source = await repo.source(users[1], relation.uuid)
  })
  afterAll(async () => {
    await client.sr_media_article_ref.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark_share.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_delete_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark.deleteMany({ where: { private_user: { in: users } } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  const input = (target = source!.bookmark.target_url) => ({
    userId: users[1],
    source: source!,
    targetUrl: target,
    uuid: crypto.randomUUID(),
    content: { content_key: `snapshots/${crypto.randomUUID()}/body.html`, content_md_key: 'new.txt', content_word_count: 4 }
  })

  it('publishes independent pointers and relational provenance without personal state', async () => {
    const result = await repo.publish(input())
    expect(result.disposition).toBe('created')
    expect(result.relation.forked_from_id).toBe(source!.id)
    expect(result.relation.is_starred).toBe(false)
    expect(result.relation.alias_title).toBe('')
    expect(result.relation.bookmark.private_user).toBe(users[1])
    const again = await repo.publish(input())
    expect(again.disposition).toBe('already_saved')
    expect(again.relation.uuid).toBe(result.relation.uuid)
    expect(again.relation.bookmark.content_key).toBe(result.relation.bookmark.content_key)
  })

  it('applies requested import state only when creating the destination', async () => {
    const data = { ...input(`https://example.com/import-${crypto.randomUUID()}`), personal: { savedAt: new Date('2020-01-02T03:04:05Z'), starred: true, archived: true } }
    const result = await repo.publish(data)
    expect(result.relation).toMatchObject({ created_at: data.personal.savedAt, is_starred: true, archive_status: 1 })
    const duplicate = await repo.publish({ ...data, personal: { starred: false, archived: false } })
    expect(duplicate.relation).toMatchObject({ created_at: data.personal.savedAt, is_starred: true, archive_status: 1 })
  })

  it('does not adopt a raw row whose relation is being deleted', async () => {
    const data = input()
    await client.sr_user_bookmark.deleteMany({ where: { user_id: users[1] } })
    await expect(repo.publish(data)).rejects.toMatchObject({ name: 'fork_destination_deleting' })
    await client.sr_bookmark.deleteMany({ where: { private_user: users[1] } })
  })

  it('checks source sharing again inside publication', async () => {
    await client.sr_bookmark_share.create({ data: { bookmark_id: source!.bookmark_id, user_id: users[0], is_enable: false } })
    await expect(repo.publish(input())).rejects.toMatchObject({ name: 'BOOKMARK_NOT_FOUND' })
    await client.sr_bookmark_share.deleteMany({ where: { user_id: users[0] } })
  })

  it('rejects a source revision changed during the copy', async () => {
    await client.sr_bookmark.update({ where: { id: source!.bookmark_id }, data: { content_key: 'changed.html' } })
    await expect(repo.publish(input())).rejects.toMatchObject({ name: 'fork_source_not_ready' })
    await client.sr_bookmark.update({ where: { id: source!.bookmark_id }, data: { content_key: 'source.html' } })
  })

  it('deduplicates concurrent copies without replacing the winner', async () => {
    const results = await Promise.allSettled([repo.publish(input()), repo.publish(input())])
    expect(
      results.some(result => result.status === 'fulfilled'),
      JSON.stringify(results.map(result => (result.status === 'rejected' ? { status: result.status, message: String(result.reason) } : { status: result.status })))
    ).toBe(true)
    expect(await client.sr_bookmark.count({ where: { target_url: source!.bookmark.target_url, private_user: users[1] } })).toBe(1)
    expect(await client.sr_user_bookmark.count({ where: { user_id: users[1] } })).toBe(1)
  })

  it('keeps queued Reader saves terminal and distinct across devices and replay', async () => {
    const sync = new DBSyncBatchOperation(() => client)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const targetUrl = `https://reader.test/b/${source!.uuid}`
    const operation = (uuid: string) => ({
      type: 'create_bookmark' as const,
      userId: users[1],
      bookmarkUuid: uuid,
      data: { targetUrl, title: 'Reader shell', isArchive: false, isNewBookmark: true, readerSourceUuid: source!.uuid }
    })
    expect(await sync.executeOrderedOperations([operation(first), operation(second)])).toEqual([])
    const before = await client.sr_user_bookmark.findMany({ where: { uuid: { in: [first, second] } }, include: { bookmark: true } })
    expect(before).toHaveLength(2)
    expect(new Set(before.map(item => item.bookmark_id)).size).toBe(2)
    expect(before.every(item => item.bookmark.status === 'failed' && item.forked_from_id === null)).toBe(true)
    await sync.executeOrderedOperations([operation(first)])
    expect((await client.sr_user_bookmark.findUnique({ where: { uuid: first } }))?.bookmark_id).toBe(before.find(item => item.uuid === first)!.bookmark_id)
  })

  it('establishes the media denial barrier before a concurrent private publication can commit', async () => {
    const sourceId = `fork-policy-${crypto.randomUUID()}`
    const row = await client.sr_media_article.create({
      data: { media_kind: 'youtube', source_id: sourceId, source_hash: 'hash', target_language: 'en', prompt_version: 'v1', schema_version: 1, status: 'ready' }
    })
    try {
      await repo.denyYoutube(sourceId)
      await expect(
        repo.publish({ ...input(`https://example.com/${sourceId}`), mediaRef: { media_kind: 'youtube', source_id: sourceId, source_hash: 'hash' } })
      ).rejects.toMatchObject({ name: 'BOOKMARK_NOT_FOUND' })
    } finally {
      await client.sr_media_article.delete({ where: { id: row.id } })
    }
  })

  it('retains a denial barrier when the video has no canonical row yet', async () => {
    const sourceId = `fork-policy-${crypto.randomUUID()}`
    try {
      await repo.denyYoutube(sourceId)
      expect(await repo.mediaDenied({ media_kind: 'youtube', source_id: sourceId, source_hash: 'hash' })).toBe(true)
    } finally {
      await client.sr_media_article.deleteMany({ where: { source_id: sourceId } })
    }
  })

  it('rechecks podcast generation inputs inside the publication transaction', async () => {
    const ep = await client.sr_podcast_episode.create({
      data: { source_id: crypto.randomUUID(), audio_url: 'https://example.com/audio.mp3', title: 'Original', transcript_hash: 'hash' }
    })
    try {
      const guard = { sourceId: ep.source_id, fingerprint: await podcastInputFingerprint(ep), transcriptHash: ep.transcript_hash }
      await client.sr_podcast_episode.update({ where: { id: ep.id }, data: { title: 'Changed during R2 copy' } })
      expect(await repo.publishRevision(source!.bookmark_id, source!.bookmark.content_key, input().content, { mediaInput: guard })).toBe(false)
      await expect(repo.publish({ ...input(), mediaInput: guard })).rejects.toMatchObject({ name: 'fork_source_not_ready' })
      expect((await repo.snapshot(source!.bookmark_id))?.content_key).toBe(source!.bookmark.content_key)
    } finally {
      await client.sr_podcast_episode.delete({ where: { id: ep.id } })
    }
  })

  it('cannot publish or mark failed using an earlier acquisition revision', async () => {
    const original = await repo.snapshot(source!.bookmark_id)
    const later = new Date(original!.updated_at.getTime() + 1000)
    await client.sr_bookmark.update({ where: { id: original!.id }, data: { updated_at: later, status: 'pending' } })
    expect(await repo.setCaptureStatus(original!.id, original!.updated_at, 'failed')).toBe(false)
    expect(await repo.publishRevision(original!.id, original!.content_key, input().content, { expectedUpdatedAt: original!.updated_at, fields: { status: 'success' } })).toBe(false)
    expect((await repo.snapshot(original!.id))?.status).toBe('pending')
  })
})
