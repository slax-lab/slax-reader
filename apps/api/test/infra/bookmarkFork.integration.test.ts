import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { podcastInputFingerprint } from '@/utils/mediaSnapshot'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { UserDeletionService } from '@/domain/userDeletion'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { memoryBucket } from '../utils/snapshotBucket'
import { readEmbeddedSnapshot, snapshotKeys } from '@/utils/snapshotBundle'

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('Fork publication against PostgreSQL', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const repo = new BookmarkForkRepo(() => client)
  const publish = async (data: Parameters<BookmarkForkRepo['publish']>[0]) => {
    return repo.publish(data)
  }
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
    await client.sr_user_bookmark_tag.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_tag.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark_comment.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_media_article_ref.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark_share.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_delete_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark.deleteMany({ where: { OR: [{ private_user: { in: users } }, { id: { in: raws } }] } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  const input = (target = source!.bookmark.target_url) => {
    const uuid = crypto.randomUUID()
    const { content_key, content_md_key } = snapshotKeys(uuid)
    return { userId: users[1], source: source!, targetUrl: target, uuid, content: { content_key, content_md_key, content_word_count: 4 } }
  }

  it.each(['publish', 'fail'])('late moderation from A leaves admitted B able to %s', async outcome => {
    const destination = await publish(input(`https://moderation-race.test/${crypto.randomUUID()}`))
    const raw = destination.relation.bookmark
    const bookmarks = new BookmarkRepo({} as any, () => client)
    const admitted = await bookmarks.createBookmark(
      { title: 'B', host_url: '', target_url: raw.target_url, content_icon: '', content_cover: '', private_user: users[1] },
      'pending'
    )
    expect(admitted!.admitted).toBe(true)
    expect(await repo.claimWrite(raw.id, admitted!.updated_at!, ['pending'], true)).toBe(true)
    expect(await bookmarks.updateBookmarkModerationResult(raw.id, 1, { revision: raw.updated_at, userId: users[1] })).toBe(false)
    expect(await repo.snapshot(raw.id)).toMatchObject({ status: 'parseing', moderation_result: 0, updated_at: admitted!.updated_at })
    expect(await client.sr_bookmark_share.findUnique({ where: { bookmark_id_user_id: { bookmark_id: raw.id, user_id: users[1] } } })).toBeNull()
    if (outcome === 'publish') {
      expect(await repo.publishRevision(raw.id, raw.content_key, input().content, { expectedUpdatedAt: admitted!.updated_at })).toBe(true)
    } else {
      expect(await repo.failWrite(raw.id, admitted!.updated_at!)).toBe(true)
    }
    expect((await repo.snapshot(raw.id))!.status).toBe(outcome === 'publish' ? 'success' : 'failed')
  })

  it('applies current moderation and share revocation atomically, rejecting stale replay', async () => {
    const destination = await publish(input(`https://moderation-current.test/${crypto.randomUUID()}`))
    const raw = destination.relation.bookmark
    const bookmarks = new BookmarkRepo({} as any, () => client)
    const capture = { revision: raw.updated_at, userId: users[1] }
    expect(await bookmarks.updateBookmarkModerationResult(raw.id, 1, capture)).toBe(true)
    expect((await repo.snapshot(raw.id))!.moderation_result).toBe(1)
    expect(await client.sr_bookmark_share.findUnique({ where: { bookmark_id_user_id: { bookmark_id: raw.id, user_id: users[1] } } })).toMatchObject({ is_enable: false })
    expect(await bookmarks.updateBookmarkModerationResult(raw.id, 0, capture)).toBe(false)
    expect((await repo.snapshot(raw.id))!.moderation_result).toBe(1)
  })

  it('atomically admits a new Fork once and excludes ordinary capture while preserving its winner timestamp', async () => {
    const targetUrl = `https://fork-admission.test/${crypto.randomUUID()}`
    const args = { userId: users[1], source: source!, targetUrl, uuid: crypto.randomUUID() }
    const results = await Promise.all([repo.admit(args), repo.admit({ ...args, uuid: crypto.randomUUID() })])
    expect(results.map(result => result.disposition).sort()).toEqual(['already_saved', 'created'])
    expect(results[0].relation.bookmark_id).toBe(results[1].relation.bookmark_id)
    expect(results[0].relation.bookmark.updated_at).toEqual(results[1].relation.bookmark.updated_at)
    const raw = results[0].relation.bookmark
    expect(raw.status).toBe('parseing')
    const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => client }) as BookmarkRepo
    const capture = await bookmarks.createBookmark(
      { title: 'Must not replace', host_url: '', target_url: targetUrl, content_icon: '', content_cover: '', private_user: users[1] },
      'pending'
    )
    expect(capture!.admitted).toBe(false)
    expect(capture!.updated_at).toEqual(raw.updated_at)
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBe('pending')
    expect(await repo.failWrite(raw.id, raw.updated_at)).toBe(true)
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBe('failed')
    const retry = await repo.admit(args)
    expect(retry.relation.bookmark.updated_at.getTime()).toBeGreaterThan(raw.updated_at.getTime())
    expect(await repo.failWrite(raw.id, raw.updated_at)).toBe(false)
  })

  it('preserves previous provenance during refresh and failure, and scopes viewer success to the exact live source', async () => {
    const targetUrl = `https://fork-refresh.test/${crypto.randomUUID()}`
    const first = await repo.publish(input(targetUrl))
    await client.sr_user_bookmark.update({ where: { id: first.relation.id }, data: { forked_from_id: 999999 } })
    const admitted = await repo.admit({ userId: users[1], source: source!, targetUrl, uuid: crypto.randomUUID() })
    expect(admitted.relation.forked_from_id).toBe(999999)
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBe('pending')
    await repo.failWrite(admitted.relation.bookmark_id, admitted.relation.bookmark.updated_at)
    expect((await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: first.relation.id } })).forked_from_id).toBe(999999)
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBe('failed')
    await client.sr_bookmark.update({ where: { id: first.relation.bookmark_id }, data: { status: 'success' } })
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBeNull()
    await client.sr_user_bookmark.update({ where: { id: first.relation.id }, data: { forked_from_id: source!.id } })
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBe('success')
    expect(await repo.viewerStatus(users[0], source!.id, targetUrl)).toBeNull()
    await client.sr_user_bookmark.update({ where: { id: first.relation.id }, data: { deleted_at: new Date() } })
    expect(await repo.viewerStatus(users[1], source!.id, targetUrl)).toBeNull()
  })

  it('cannot publish a Fork whose admitted relation was trashed or deleted during copy', async () => {
    for (const deletion of ['trash', 'delete']) {
      const targetUrl = `https://fork-deletion.test/${crypto.randomUUID()}`
      const admitted = await repo.admit({ userId: users[1], source: source!, targetUrl, uuid: crypto.randomUUID() })
      const relation = admitted.relation
      const destination = { id: relation.id, bookmark_id: relation.bookmark_id, updated_at: relation.bookmark.updated_at, requireLive: true }
      if (deletion === 'trash') await client.sr_user_bookmark.update({ where: { id: relation.id }, data: { deleted_at: new Date() } })
      else await client.sr_user_bookmark.delete({ where: { id: relation.id } })
      await expect(repo.publish({ ...input(targetUrl), uuid: relation.uuid, destination })).rejects.toMatchObject({ name: 'fork_destination_in_progress' })
      expect((await repo.snapshot(relation.bookmark_id))!.status).toBe('parseing')
    }
  })

  it.each(['before-execution', 'before-copy'])('fails an admission trashed %s so restore can retry, without failing a newer admission', async timing => {
    const targetUrl = `https://fork-cancel.test/${crypto.randomUUID()}`
    const ctx = { getUserId: () => users[1] } as any
    const service = Object.assign(Object.create(BookmarkForkService.prototype), {
      repo,
      labs: { assertUrlAllowed: async () => {}, assertEnabled: async () => {} },
      search: { clearSearchCache: async () => {} }
    }) as BookmarkForkService
    const accepted = await repo.admit({ userId: users[1], source: source!, targetUrl, uuid: crypto.randomUUID() })
    const relation = accepted.relation
    const job = {
      sourceUuid: source!.uuid,
      sourceId: source!.id,
      sourceBookmarkId: source!.bookmark_id,
      sourceRevision: source!.bookmark.updated_at.toISOString(),
      sourceType: source!.type,
      destinationUuid: relation.uuid,
      destinationId: relation.id,
      revision: relation.bookmark.updated_at.toISOString(),
      created: true
    }
    const trash = () => client.sr_user_bookmark.update({ where: { id: relation.id }, data: { deleted_at: new Date() } })
    if (timing === 'before-execution') await trash()
    else {
      const snapshot = repo.snapshot.bind(repo)
      vi.spyOn(repo, 'snapshot').mockImplementationOnce(async id => {
        await trash()
        return snapshot(id)
      })
    }
    await service.execute(ctx, relation.bookmark_id, job)
    vi.restoreAllMocks()
    expect((await repo.snapshot(relation.bookmark_id))!.status).toBe('failed')
    await client.sr_user_bookmark.update({ where: { id: relation.id }, data: { deleted_at: null } })
    const retry = await repo.admit({ userId: users[1], source: source!, targetUrl, uuid: crypto.randomUUID() })
    expect(retry.disposition).toBe('updated')
    expect(retry.relation.bookmark.updated_at.getTime()).toBeGreaterThan(relation.bookmark.updated_at.getTime())
    await service.execute(ctx, relation.bookmark_id, job)
    const current = (await repo.snapshot(relation.bookmark_id))!
    expect(current.status).toBe('parseing')
    expect(current.updated_at).toEqual(retry.relation.bookmark.updated_at)
  })

  it('keeps a lost-ACK Workflow claim while a fixed-key PUT blocks competing admission', async () => {
    const sourceRaw = await client.sr_bookmark.create({
      data: {
        title: 'Lost acknowledgement source',
        target_url: `https://fork-lost-ack.test/${crypto.randomUUID()}`,
        private_user: users[0],
        status: 'success',
        content_key: 'source.html',
        created_at: new Date(),
        updated_at: new Date(),
        published_at: new Date()
      }
    })
    const sourceRelation = await client.sr_user_bookmark.create({ data: { user_id: users[0], bookmark_id: sourceRaw.id, updated_at: new Date() } })
    const currentSource = (await repo.source(users[1], sourceRelation.uuid))!
    const memory = memoryBucket()
    await memory.bucket.put('source.html', '<html><body>Accepted source</body></html>')
    let releasePut!: () => void
    let enteredPut!: () => void
    const blocked = new Promise<void>(resolve => {
      releasePut = resolve
    })
    const entered = new Promise<void>(resolve => {
      enteredPut = resolve
    })
    const put = memory.bucket.put.bind(memory.bucket)
    vi.spyOn(memory.bucket, 'put').mockImplementationOnce(async (...args) => {
      enteredPut()
      await blocked
      return put(...args)
    })
    let execution: Promise<void> | undefined
    let acceptedId = ''
    const ctx = {
      getUserId: () => users[1],
      getEncodeUserId: () => 1,
      getlang: () => 'en',
      env: {
        CRAWL_WORKFLOW: {
          create: async (request: any) => {
            acceptedId = request.id
            execution = service.execute(ctx, request.params.bookmarkId, request.params.fork)
            await entered
            throw new Error('create accepted, response lost')
          },
          get: async (id: string) => {
            expect(id).toBe(acceptedId)
            return { status: async () => ({ status: 'running' }) }
          }
        }
      }
    } as any
    const service = Object.assign(Object.create(BookmarkForkService.prototype), {
      repo,
      labs: { assertUrlAllowed: async () => {}, assertEnabled: async () => {} },
      search: { clearSearchCache: async () => {} },
      bucket: () => ({ R2Bucket: memory.bucket }),
      media: { copyForFork: async () => undefined },
      afterCommit: async () => {}
    }) as BookmarkForkService
    try {
      const admitted = await service.admit(ctx, currentSource.uuid)
      const raw = (await repo.snapshot(admitted.bookmark_id))!
      expect(raw.status).toBe('parseing')
      const competing = await repo.admit({
        userId: users[1],
        source: currentSource,
        targetUrl: currentSource.bookmark.target_url,
        uuid: crypto.randomUUID()
      })
      expect(competing.disposition).toBe('already_saved')
      expect(competing.relation.bookmark.updated_at).toEqual(raw.updated_at)
      releasePut()
      await execution
      const published = (await repo.snapshot(admitted.bookmark_id))!
      expect(published.status).toBe('success')
      expect(await (await memory.bucket.get(published.content_key))!.text()).toContain('Accepted source')
      const next = await repo.admit({ userId: users[1], source: currentSource, targetUrl: currentSource.bookmark.target_url, uuid: crypto.randomUUID() })
      expect(next.disposition).toBe('updated')
      expect(next.relation.bookmark.updated_at.getTime()).toBeGreaterThan(raw.updated_at.getTime())
      await repo.failWrite(admitted.bookmark_id, next.relation.bookmark.updated_at)
    } finally {
      releasePut()
      await execution?.catch(() => {})
      vi.restoreAllMocks()
    }
  })
  it('deletes only the removed account managed bundles and tolerates R2 deletion failure', async () => {
    const user = await client.sr_user.create({ data: { email: `${crypto.randomUUID()}@delete.test`, name: 'Removed', created_at: new Date(), last_login_at: new Date() } })
    users.push(user.id)
    const memory = memoryBucket()
    for (const content_key of ['html/body/removed-one.html', 'pdf/body/removed-two.pdf']) {
      await client.sr_bookmark.create({
        data: {
          target_url: `https://delete.test/${crypto.randomUUID()}`,
          private_user: user.id,
          content_key,
          created_at: new Date(),
          updated_at: new Date(),
          published_at: new Date()
        }
      })
      await memory.bucket.put(content_key, 'owned')
    }
    await memory.bucket.put('html/body/other-one.html', 'keep')
    const deletion = new UserDeletionService(
      () => client,
      {} as any,
      () => ({ R2Bucket: memory.bucket }) as any
    )
    await deletion.cleanupUserData(user.id)
    expect([...memory.objects.keys()]).toEqual(['html/body/other-one.html'])
    expect(await client.sr_bookmark.count({ where: { private_user: user.id } })).toBe(0)
    expect(await client.sr_bookmark.findUnique({ where: { id: source!.bookmark_id } })).not.toBeNull()
    await client.sr_bookmark.create({
      data: {
        target_url: `https://delete.test/${crypto.randomUUID()}`,
        private_user: user.id,
        content_key: 'html/body/removed-failed.html',
        created_at: new Date(),
        updated_at: new Date(),
        published_at: new Date()
      }
    })
    const failedR2 = new UserDeletionService(
      () => client,
      {} as any,
      () =>
        ({
          R2Bucket: {
            delete: async () => {
              throw new Error('R2 unavailable')
            }
          }
        }) as any
    )
    await expect(failedR2.cleanupUserData(user.id)).resolves.toBeUndefined()
    expect(await client.sr_bookmark.count({ where: { private_user: user.id } })).toBe(0)
  })

  it('publishes independent pointers and relational provenance without personal state', async () => {
    const result = await publish(input())
    expect(result.disposition).toBe('created')
    expect(result.relation.forked_from_id).toBe(source!.id)
    expect(result.relation.is_starred).toBe(false)
    expect(result.relation.alias_title).toBe('')
    expect(result.relation.bookmark.private_user).toBe(users[1])
    const again = await publish(input())
    expect(again.disposition).toBe('already_saved')
    expect(again.relation.uuid).toBe(result.relation.uuid)
    expect(again.relation.bookmark.content_key).toBe(result.relation.bookmark.content_key)
  })

  it('applies requested import state only when creating the destination', async () => {
    const data = {
      ...input(`https://example.com/import-${crypto.randomUUID()}`),
      personal: {
        savedAt: new Date('2020-01-02T03:04:05Z'),
        starred: true,
        archived: true
      }
    }
    const result = await publish(data)
    expect(result.relation).toMatchObject({
      created_at: data.personal.savedAt,
      is_starred: true,
      archive_status: 1
    })
    const duplicate = await publish({
      ...data,
      personal: { starred: false, archived: false }
    })
    expect(duplicate.relation).toMatchObject({
      created_at: data.personal.savedAt,
      is_starred: true,
      archive_status: 1
    })
  })

  it('does not adopt a raw row whose relation is being deleted', async () => {
    const data = input()
    await client.sr_user_bookmark.deleteMany({ where: { user_id: users[1] } })
    await expect(publish(data)).rejects.toMatchObject({
      name: 'fork_destination_deleting'
    })
    await client.sr_bookmark.deleteMany({ where: { private_user: users[1] } })
  })

  it('checks source sharing again inside publication', async () => {
    await client.sr_bookmark_share.create({
      data: {
        bookmark_id: source!.bookmark_id,
        user_id: users[0],
        is_enable: false
      }
    })
    await expect(publish(input())).rejects.toMatchObject({
      name: 'BOOKMARK_NOT_FOUND'
    })
    await client.sr_bookmark_share.deleteMany({ where: { user_id: users[0] } })
  })

  it('rejects a source revision changed during the copy', async () => {
    await client.sr_bookmark.update({
      where: { id: source!.bookmark_id },
      data: { content_key: 'changed.html' }
    })
    await expect(publish(input())).rejects.toMatchObject({
      name: 'fork_source_not_ready'
    })
    await client.sr_bookmark.update({
      where: { id: source!.bookmark_id },
      data: { content_key: 'source.html' }
    })
  })

  it('deduplicates concurrent copies without replacing the winner', async () => {
    const results = await Promise.allSettled([publish(input()), publish(input())])
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
        publish({
          ...input(`https://example.com/${sourceId}`),
          mediaRef: {
            media_kind: 'youtube',
            source_id: sourceId,
            source_hash: 'hash'
          }
        })
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
      await expect(publish({ ...input(), mediaInput: guard })).rejects.toMatchObject({ name: 'fork_source_not_ready' })
      expect((await repo.snapshot(source!.bookmark_id))?.content_key).toBe(source!.bookmark.content_key)
    } finally {
      await client.sr_podcast_episode.delete({ where: { id: ep.id } })
    }
  })

  async function recaptureFixture() {
    const { relation } = await publish(input(`https://example.com/recapture-${crypto.randomUUID()}`))
    await client.sr_user_bookmark.update({
      where: { id: relation.id },
      data: { alias_title: 'My title', is_starred: true, archive_status: 1 }
    })
    expect(await repo.claimWrite(relation.bookmark_id, relation.bookmark.updated_at)).toBe(true)
    const before = await client.sr_user_bookmark.findUniqueOrThrow({
      where: { id: relation.id }
    })
    const memory = memoryBucket()
    await memory.bucket.put(relation.bookmark.content_key, '<article>Forked body</article>')
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      repo,
      bucket: () => ({ R2Bucket: memory.bucket })
    }) as MediaSnapshotService
    return { relation, before, memory, service }
  }

  it.each(['html', 'youtube', 'podcast'] as const)('clears attribution only when an independent %s capture publishes, preserving personal state', async kind => {
    const { relation, before, memory, service } = await recaptureFixture()
    const media =
      kind === 'html'
        ? null
        : {
            schema: 1 as const,
            kind,
            mode: 'capture' as const,
            revision: 'new',
            sourceId: `recapture-${relation.id}`,
            sourceHash: 'new-input',
            inputFingerprint: 'new-input',
            defaultLanguage: 'en' as const,
            transcript: 'ready' as const,
            bodyLanguage: null,
            variants: { en: { status: 'pending' as const } }
          }
    const content = await service.capture(relation.bookmark_id, relation.uuid, { html: '<article>My capture</article>', text: 'My capture' }, {}, media)
    const after = await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: relation.id } })
    expect(after).toMatchObject({
      ...before,
      metadata: { ...(before.metadata as Record<string, unknown>), bookmark: expect.objectContaining({ content_word_count: 10 }) },
      forked_from_id: null,
      updated_at: expect.any(Date)
    })
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime())
    expect((await repo.snapshot(relation.bookmark_id))?.content_key).toBe(content.content_key)
    expect(await (await memory.bucket.get(content.content_key))!.text()).toContain('My capture')
    const manifest = readEmbeddedSnapshot(await (await memory.bucket.get(content.content_key))!.text()).manifest
    expect(manifest).toMatchObject(kind === 'html' ? { kind: 'html' } : { kind, mode: 'capture', variants: { en: { status: 'pending' } } })
    expect((await repo.source(users[1], source!.uuid))?.bookmark.content_key).toBe(source!.bookmark.content_key)
  })

  it('retains attribution when a write fails or a later acquisition supersedes publication', async () => {
    const { relation, before, memory, service } = await recaptureFixture()
    const put = memory.bucket.put.bind(memory.bucket)
    memory.bucket.put = async () => {
      throw new Error('R2 unavailable')
    }
    await expect(service.capture(relation.bookmark_id, relation.uuid, { html: '<article>New</article>', text: 'New' }, {}, null)).rejects.toThrow('R2 unavailable')
    memory.bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
      const result = await put(...args)
      if (args[0].endsWith('.html')) {
        await client.sr_bookmark.update({ where: { id: relation.bookmark_id }, data: { updated_at: new Date(Date.now() + 1000) } })
      }
      return result
    }
    await expect(service.capture(relation.bookmark_id, relation.uuid, { html: '<article>New</article>', text: 'New' }, {}, null)).rejects.toThrow('Capture revision superseded')
    expect(await client.sr_user_bookmark.findUnique({ where: { id: relation.id } })).toEqual(before)
    expect((await repo.snapshot(relation.bookmark_id))?.content_key).toBe(relation.bookmark.content_key)
    expect([...memory.objects.keys()].sort()).toEqual([relation.bookmark.content_key, relation.bookmark.content_md_key].sort())
  })

  it('keeps attribution during media settlement or policy publication', async () => {
    const { relation, before } = await recaptureFixture()
    const content = input().content
    expect(await repo.publishRevision(relation.bookmark_id, relation.bookmark.content_key, content, { expectedUpdatedAt: relation.bookmark.updated_at })).toBe(true)
    expect(await client.sr_user_bookmark.findUnique({ where: { id: relation.id } })).toMatchObject({
      forked_from_id: before.forked_from_id,
      uuid: before.uuid,
      alias_title: before.alias_title,
      is_starred: before.is_starred,
      archive_status: before.archive_status
    })
  })

  it('rolls back the content pointer if clearing attribution fails', async () => {
    const { relation, before, service } = await recaptureFixture()
    await client.$executeRawUnsafe(`CREATE FUNCTION reject_fork_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.id = ${relation.id} AND OLD.forked_from_id IS NOT NULL AND NEW.forked_from_id IS NULL THEN RAISE EXCEPTION 'fixture provenance failure'; END IF;
      RETURN NEW; END $$`)
    await client.$executeRawUnsafe('CREATE TRIGGER reject_fork_clear BEFORE UPDATE ON sr_user_bookmark FOR EACH ROW EXECUTE FUNCTION reject_fork_clear()')
    try {
      await expect(service.capture(relation.bookmark_id, relation.uuid, { html: '<article>New</article>', text: 'New' }, {}, null)).rejects.toThrow('fixture provenance failure')
      expect((await repo.snapshot(relation.bookmark_id))?.content_key).toBe(relation.bookmark.content_key)
      expect(await client.sr_user_bookmark.findUnique({ where: { id: relation.id } })).toEqual(before)
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER reject_fork_clear ON sr_user_bookmark')
      await client.$executeRawUnsafe('DROP FUNCTION reject_fork_clear()')
    }
  })

  it('clears PDF provenance for new bytes but preserves it for cached extraction', async () => {
    const { relation, before } = await recaptureFixture()
    const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => client }) as BookmarkRepo
    await bookmarks.completePdfBookmark(relation.bookmark_id, { status: 'success' }, 'document', { expectedRevision: relation.bookmark.updated_at.toISOString() })
    expect((await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: relation.id } })).forked_from_id).toBe(before.forked_from_id)
    const next = (await repo.snapshot(relation.bookmark_id))!
    expect(await repo.claimWrite(next.id, next.updated_at)).toBe(true)
    await bookmarks.completePdfBookmark(relation.bookmark_id, { status: 'success', content_key: 'pdf/body/independent.pdf' }, 'new-document', {
      clearForkProvenance: true,
      expectedRevision: (await repo.snapshot(relation.bookmark_id))!.updated_at.toISOString()
    })
    const after = await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: relation.id } })
    expect(after).toMatchObject({
      uuid: before.uuid,
      forked_from_id: null,
      alias_title: before.alias_title,
      is_starred: before.is_starred,
      metadata: { pdf_document_id: 'new-document' }
    })
  })

  it('rejects stale PDF acquisition before changing content or provenance', async () => {
    const { relation, before } = await recaptureFixture()
    const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => client }) as BookmarkRepo
    const expectedRevision = relation.bookmark.updated_at.toISOString()
    await client.sr_bookmark.update({ where: { id: relation.bookmark_id }, data: { updated_at: new Date(relation.bookmark.updated_at.getTime() + 1000) } })
    await expect(
      bookmarks.completePdfBookmark(relation.bookmark_id, { status: 'success', content_key: 'pdf/body/stale.pdf' }, 'stale-document', {
        clearForkProvenance: true,
        expectedRevision
      })
    ).rejects.toMatchObject({ code: 'P2025' })
    expect((await repo.snapshot(relation.bookmark_id))?.content_key).toBe(relation.bookmark.content_key)
    expect(await client.sr_user_bookmark.findUnique({ where: { id: relation.id } })).toEqual(before)
  })

  it('admits one concurrent same-URL create and one capture owner without resetting the loser', async () => {
    const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => client }) as BookmarkRepo
    const target = `https://admission.test/${crypto.randomUUID()}`
    const info = { title: 'Concurrent', host_url: 'admission.test', target_url: target, content_icon: '', content_cover: '', private_user: users[1] }
    const results = await Promise.all([bookmarks.createBookmark(info, 'pending'), bookmarks.createBookmark(info, 'pending')])
    expect(results.filter(result => result?.admitted)).toHaveLength(1)
    expect(new Set(results.map(result => result!.id)).size).toBe(1)
    const row = results.find(result => result!.admitted)!
    await bookmarks.createBookmarkRelation(users[1], row.id, 0, false)
    const claims = await Promise.all([repo.claimWrite(row.id, row.updated_at, ['pending']), repo.claimWrite(row.id, row.updated_at, ['pending'])])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const busy = await bookmarks.createBookmark({ ...info, title: 'Must not reset' }, 'pending')
    expect(busy!.admitted).toBe(false)
    expect(busy!.updated_at).toEqual(row.updated_at)
    expect(busy!.title).toBe('Concurrent')
    expect(await repo.ownsWrite(row.id, row.updated_at)).toBe(true)
    expect(await repo.failWrite(row.id, new Date(row.updated_at.getTime() - 1))).toBe(false)
    expect(await repo.ownsWrite(row.id, row.updated_at)).toBe(true)
    const keys = snapshotKeys(crypto.randomUUID())
    expect(await repo.publishRevision(row.id, row.content_key, { ...keys, content_word_count: 10 }, { expectedUpdatedAt: row.updated_at })).toBe(true)
    const completed = (await repo.snapshot(row.id))!
    expect(completed.updated_at.getTime()).toBeGreaterThan(row.updated_at.getTime())
    expect(await repo.claimWrite(row.id, row.updated_at)).toBe(false)
  })

  it('admits one concurrent sync create across devices without rejecting the busy replay', async () => {
    const sync = new DBSyncBatchOperation(() => client)
    const targetUrl = `https://sync-race.test/${crypto.randomUUID()}`
    const operation = () => ({
      type: 'create_bookmark' as const,
      userId: users[1],
      bookmarkUuid: crypto.randomUUID(),
      data: { targetUrl, title: 'Concurrent sync', isArchive: false, isNewBookmark: true }
    })
    const results = await Promise.all([sync.executeOrderedOperations([operation()]), sync.executeOrderedOperations([operation()])])
    expect(results.flat()).toHaveLength(1)
    const rows = await client.sr_bookmark.findMany({ where: { target_url: targetUrl, private_user: users[1] }, include: { userBookmarks: true } })
    expect(rows).toHaveLength(1)
    expect(rows[0].userBookmarks).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
  })

  it('privatizes one historical owner while preserving identity and personal references', async () => {
    const now = new Date()
    const shared = await client.sr_bookmark.create({
      data: {
        target_url: `https://legacy.test/${crypto.randomUUID()}`,
        private_user: 0,
        title: 'Shared original',
        status: 'success',
        content_key: 'html/body/shared.html',
        content_md_key: 'text/body/shared.txt',
        created_at: now,
        updated_at: now,
        published_at: now
      }
    })
    raws.push(shared.id)
    const owner = await client.sr_user_bookmark.create({
      data: { user_id: users[1], bookmark_id: shared.id, alias_title: 'My alias', is_starred: true, archive_status: 1, updated_at: now }
    })
    const other = await client.sr_user_bookmark.create({ data: { user_id: users[0], bookmark_id: shared.id, updated_at: now } })
    const tag = await client.sr_user_tag.create({ data: { user_id: users[1], tag_name: `legacy-${crypto.randomUUID()}` } })
    const link = await client.sr_user_bookmark_tag.create({ data: { user_id: users[1], bookmark_id: shared.id, tag_id: tag.id, tag_name: tag.tag_name } })
    const share = await client.sr_bookmark_share.create({ data: { user_id: users[1], bookmark_id: shared.id, share_code: crypto.randomUUID() } })
    const mark = await client.sr_bookmark_comment.create({
      data: { user_id: users[1], bookmark_id: shared.id, user_bookmark_uuid: owner.uuid, type: 1, content: 'Saved highlight', updated_at: now }
    })
    const bookmarks = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => client }) as BookmarkRepo
    const admitted = await bookmarks.createBookmark(
      { title: 'Recapture', host_url: 'legacy.test', target_url: shared.target_url, content_icon: '', content_cover: '', private_user: users[1] },
      'pending'
    )
    expect(admitted!.admitted).toBe(true)
    expect(admitted!.id).not.toBe(shared.id)
    expect(admitted!.content_key).toMatch(/^html\/body\/[^/]+\.html$/)
    expect(admitted!.content_key).not.toBe(shared.content_key)
    const moved = await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: owner.id } })
    expect(moved).toMatchObject({ id: owner.id, uuid: owner.uuid, alias_title: owner.alias_title, is_starred: true, archive_status: 1, bookmark_id: admitted!.id })
    expect((await client.sr_user_bookmark_tag.findUniqueOrThrow({ where: { id: link.id } })).bookmark_id).toBe(admitted!.id)
    expect((await client.sr_bookmark_share.findUniqueOrThrow({ where: { id: share.id } })).bookmark_id).toBe(admitted!.id)
    expect(await client.sr_bookmark_comment.findUniqueOrThrow({ where: { id: mark.id } })).toMatchObject({ id: mark.id, user_bookmark_uuid: owner.uuid, content: mark.content })
    expect(await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other)
    expect(await client.sr_bookmark.findUniqueOrThrow({ where: { id: shared.id } })).toEqual(shared)
  })

  it('rejects a sync create against a deleting raw while Reader replay does not block unrelated mutation', async () => {
    const sync = new DBSyncBatchOperation(() => client)
    const now = new Date()
    const raw = await client.sr_bookmark.create({
      data: { target_url: `https://deleting.test/${crypto.randomUUID()}`, private_user: users[1], status: 'success', created_at: now, updated_at: now, published_at: now }
    })
    const create = (uuid: string, targetUrl: string, readerSourceUuid?: string) => ({
      type: 'create_bookmark' as const,
      userId: users[1],
      bookmarkUuid: uuid,
      data: { targetUrl, title: 'Save', isArchive: false, isNewBookmark: true, ...(readerSourceUuid ? { readerSourceUuid } : {}) }
    })
    await expect(sync.executeOrderedOperations([create(crypto.randomUUID(), raw.target_url)])).rejects.toThrow()
    expect(await client.sr_user_bookmark.count({ where: { bookmark_id: raw.id } })).toBe(0)
    const uuid = crypto.randomUUID()
    const queued = create(uuid, `https://reader.test/b/${source!.uuid}`, source!.uuid)
    await sync.executeOrderedOperations([queued])
    const saved = await client.sr_user_bookmark.findUniqueOrThrow({ where: { uuid } })
    const unrelatedRaw = await client.sr_bookmark.create({
      data: { target_url: `https://unrelated.test/${crypto.randomUUID()}`, private_user: users[1], status: 'success', created_at: now, updated_at: now, published_at: now }
    })
    const unrelated = await client.sr_user_bookmark.create({ data: { user_id: users[1], bookmark_id: unrelatedRaw.id, updated_at: now } })
    await sync.executeOrderedOperations([queued, { type: 'update_bookmark', userId: users[1], bookmarkUuid: unrelated.uuid, data: { is_starred: true } } as any])
    const after = await client.sr_user_bookmark.findUniqueOrThrow({ where: { uuid }, include: { bookmark: true } })
    expect(after.id).toBe(saved.id)
    expect((await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: unrelated.id } })).is_starred).toBe(true)
    expect(after.bookmark.status).toBe('failed')
    expect(after.bookmark_id).toBe(saved.bookmark_id)
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
