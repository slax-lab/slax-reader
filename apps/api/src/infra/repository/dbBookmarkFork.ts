import { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { BookmarkNotFoundError } from '@/const/err'
import { ErrorName } from '@slax-reader/contracts'
import { forkError } from '@/utils/bookmarkForkError'
import { podcastInputFingerprint, type PodcastSnapshotInput } from '@/utils/mediaSnapshot'

type Database = Prisma.TransactionClient
export type MediaSnapshotRef = { media_kind: string; source_id: string; source_hash: string }
export type ForkSource = NonNullable<Awaited<ReturnType<BookmarkForkRepo['source']>>>
export type ForkContent = { content_key: string; content_md_key: string; content_word_count: number }
export type ForkPersonalState = { savedAt?: Date; starred?: boolean; archived?: boolean }
export type ForkPublication = {
  userId: number
  source: ForkSource
  targetUrl: string
  uuid: string
  content: ForkContent
  pdfDocumentId?: string
  mediaRef?: MediaSnapshotRef
  mediaInput?: PodcastSnapshotInput
  personal?: ForkPersonalState
}

@injectable()
export class BookmarkForkRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private client: LazyInstance<PrismaClient>) {}

  async source(viewer: number, uuid: string, db: Database = this.client()) {
    const relation = await db.sr_user_bookmark.findUnique({ where: { uuid }, include: { bookmark: true } })
    if (!relation?.bookmark) return null
    const owner = await db.sr_user.findUnique({ where: { id: relation.user_id } })
    if (!owner || owner.deleted_at) return null
    const share = await db.sr_bookmark_share.findUnique({ where: { bookmark_id_user_id: { bookmark_id: relation.bookmark_id, user_id: relation.user_id } } })
    if (viewer !== relation.user_id && (relation.deleted_at || relation.bookmark.moderation_result > 0 || (share ? !share.is_enable : !owner.snapshot_sharing))) return null
    return { ...relation, owner, share }
  }

  async sourceById(viewer: number, id: number) {
    const relation = await this.client().sr_user_bookmark.findUnique({ where: { id }, select: { uuid: true } })
    const source = relation ? await this.source(viewer, relation.uuid) : null
    return source?.id === id ? source : null
  }

  async destination(userId: number, targetUrl: string, db: Database = this.client()) {
    const raw = await db.sr_bookmark.findUnique({ where: { target_url_private_user: { target_url: targetUrl, private_user: userId } } })
    if (!raw) return null
    const relation = await db.sr_user_bookmark.findUnique({ where: { user_id_bookmark_id: { user_id: userId, bookmark_id: raw.id } }, include: { bookmark: true } })
    if (!relation) throw forkError(ErrorName.FORK_DESTINATION_DELETING)
    if (raw.status === 'failed') throw forkError(ErrorName.FORK_DESTINATION_FAILED)
    if (raw.status !== 'success') throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
    return relation
  }

  async existing(userId: number, targetUrl: string) {
    return this.client().$transaction(async db => {
      const relation = await this.destination(userId, targetUrl, db)
      return relation ? this.restore(db, relation) : null
    })
  }

  async ownSource(userId: number, uuid: string) {
    return this.client().$transaction(async db => {
      const source = await this.source(userId, uuid, db)
      if (!source || source.user_id !== userId) throw BookmarkNotFoundError()
      if (source.bookmark.status === 'failed') throw forkError(ErrorName.FORK_DESTINATION_FAILED)
      if (source.bookmark.status !== 'success') throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
      return this.restore(db, source)
    })
  }

  private async restore(db: Database, relation: NonNullable<Awaited<ReturnType<BookmarkForkRepo['destination']>>>) {
    if (!relation.deleted_at) return relation
    await db.sr_user_delete_bookmark.deleteMany({ where: { user_id: relation.user_id, bookmark_id: relation.bookmark_id } })
    await db.sr_user_bookmark_tag.updateMany({ where: { user_id: relation.user_id, bookmark_id: relation.bookmark_id }, data: { is_deleted: false } })
    return db.sr_user_bookmark.update({ where: { id: relation.id }, data: { deleted_at: null, updated_at: new Date() }, include: { bookmark: true } })
  }

  async publish(input: ForkPublication) {
    return this.client().$transaction(
      async db => {
        if (input.mediaRef) await this.assertMediaPolicy(db, input.mediaRef)
        if (input.mediaInput && !(await this.matchesMediaInput(db, input.mediaInput))) throw forkError()
        // Lock identity/access rows until publication. R2 transfers have already finished.
        await db.$queryRaw`SELECT id FROM sr_user WHERE id IN (${input.userId}, ${input.source.user_id}) FOR SHARE`
        await db.$queryRaw`SELECT id FROM sr_user_bookmark WHERE id = ${input.source.id} FOR SHARE`
        await db.$queryRaw`SELECT id FROM sr_bookmark WHERE id = ${input.source.bookmark_id} FOR SHARE`
        await db.$queryRaw`SELECT id FROM sr_bookmark_share WHERE bookmark_id = ${input.source.bookmark_id} AND user_id = ${input.source.user_id} FOR SHARE`
        const user = await db.sr_user.findUnique({ where: { id: input.userId } })
        const current = await this.source(input.userId, input.source.uuid, db)
        if (!user || user.deleted_at || !current || current.id !== input.source.id || current.bookmark_id !== input.source.bookmark_id) throw BookmarkNotFoundError()
        const before = input.source.bookmark
        const after = current.bookmark
        if (
          current.type !== input.source.type ||
          (current.metadata as Prisma.JsonObject)?.pdf_document_id !== (input.source.metadata as Prisma.JsonObject)?.pdf_document_id ||
          after.target_url !== before.target_url ||
          after.content_key !== before.content_key ||
          after.content_md_key !== before.content_md_key ||
          after.status !== 'success' ||
          after.moderation_result !== before.moderation_result ||
          after.updated_at.getTime() !== before.updated_at.getTime()
        )
          throw forkError()

        const existing = await this.destination(input.userId, input.targetUrl, db)
        if (existing) return { disposition: 'already_saved' as const, relation: await this.restore(db, existing) }

        const now = new Date()
        const bookmark = await db.sr_bookmark.create({
          data: {
            title: before.title,
            target_url: input.targetUrl,
            host_url: before.host_url,
            site_name: before.site_name,
            content_icon: before.content_icon,
            content_cover: before.content_cover,
            description: before.description,
            byline: before.byline,
            published_at: before.published_at,
            moderation_result: before.moderation_result,
            private_user: input.userId,
            status: 'success',
            created_at: now,
            updated_at: now,
            ...input.content
          }
        })
        let relation = await db.sr_user_bookmark.create({
          data: {
            uuid: input.uuid,
            user_id: input.userId,
            bookmark_id: bookmark.id,
            forked_from_id: current.id,
            type: current.type,
            created_at: input.personal?.savedAt ?? now,
            is_starred: input.personal?.starred ?? false,
            archive_status: input.personal?.archived ? 1 : 0,
            updated_at: now
          },
          include: { bookmark: true }
        })
        // The insert trigger replaces metadata; merge PDF identity only after insertion.
        if (input.pdfDocumentId) {
          await db.$executeRaw`UPDATE sr_user_bookmark SET metadata = metadata || jsonb_build_object('pdf_document_id', ${input.pdfDocumentId}::text) WHERE id = ${relation.id}`
          relation = (await db.sr_user_bookmark.findUnique({ where: { id: relation.id }, include: { bookmark: true } }))!
        }
        if (input.mediaRef) await db.sr_media_article_ref.create({ data: { ...input.mediaRef, bookmark_id: bookmark.id, user_id: input.userId } })
        return { disposition: 'created' as const, relation }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }
    )
  }

  /** Fresh authoritative lookup after a possibly acknowledged COMMIT. Never infer rollback from a read failure. */
  async reconcile(userId: number, targetUrl: string) {
    return this.destination(userId, targetUrl)
  }

  async referenced(keys: string[]) {
    return !!(await this.client().sr_bookmark.findFirst({ where: { OR: [{ content_key: { in: keys } }, { content_md_key: { in: keys } }] }, select: { id: true } }))
  }

  async snapshot(bookmarkId: number) {
    return this.client().sr_bookmark.findUnique({ where: { id: bookmarkId }, include: { userBookmarks: { take: 1, select: { uuid: true, user_id: true } } } })
  }

  async listSnapshots(afterId: number, limit: number) {
    return this.client().sr_bookmark.findMany({
      where: { id: { gt: afterId }, OR: [{ content_key: { startsWith: 'snapshots/' } }, { content_key: { startsWith: 'pdf/body/forks/' } }], status: 'success' },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true }
    })
  }

  async setCaptureStatus(bookmarkId: number, revision: Date, status: string) {
    return (await this.client().sr_bookmark.updateMany({ where: { id: bookmarkId, updated_at: revision }, data: { status } })).count === 1
  }

  async mediaRef(bookmarkId: number) {
    return this.client().sr_media_article_ref.findUnique({ where: { bookmark_id: bookmarkId } })
  }

  async mediaDenied(ref: MediaSnapshotRef, db: Database = this.client()) {
    if (ref.media_kind === 'youtube')
      return !!(await db.sr_media_article.findFirst({ where: { media_kind: 'youtube', source_id: ref.source_id, status: 'takedown' }, select: { id: true } }))
    const episode = await db.sr_podcast_episode.findUnique({ where: { source_id: ref.source_id }, select: { error_message: true } })
    return episode?.error_message?.startsWith('moderation') ?? false
  }

  private async assertMediaPolicy(db: Database, ref: MediaSnapshotRef, allowDenied = false) {
    // All private publication and policy transitions use the same source-scoped transaction lock.
    const identity = `${ref.media_kind}:${ref.source_id}`
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))::text`
    if (!allowDenied && (await this.mediaDenied(ref, db))) throw BookmarkNotFoundError()
  }

  async denyYoutube(sourceId: string) {
    return this.client().$transaction(async db => {
      await this.assertMediaPolicy(db, { media_kind: 'youtube', source_id: sourceId, source_hash: '' }, true)
      const changed = await db.sr_media_article.updateMany({
        where: { media_kind: 'youtube', source_id: sourceId },
        data: { status: 'takedown', lease_until: null, next_retry_at: null }
      })
      if (!changed.count) {
        // Keep a durable barrier even before the first canonical result exists.
        await db.sr_media_article.create({ data: { media_kind: 'youtube', source_id: sourceId, source_hash: '', target_language: 'en', prompt_version: 'v1', status: 'takedown' } })
      }
    })
  }

  async denyPodcast(sourceId: string) {
    return this.client().$transaction(async db => {
      await this.assertMediaPolicy(db, { media_kind: 'podcast', source_id: sourceId, source_hash: '' }, true)
      await db.sr_podcast_episode.updateMany({
        where: { source_id: sourceId },
        data: { transcript_status: 'skipped', error_message: 'moderation', lease_until: null, next_retry_at: null }
      })
    })
  }

  private async matchesMediaInput(db: Database, expected: PodcastSnapshotInput) {
    await db.$queryRaw`SELECT id FROM sr_podcast_episode WHERE source_id = ${expected.sourceId} FOR SHARE`
    const ep = await db.sr_podcast_episode.findUnique({ where: { source_id: expected.sourceId } })
    return !!ep && ep.transcript_hash === expected.transcriptHash && (await podcastInputFingerprint(ep)) === expected.fingerprint
  }

  async publishRevision(
    bookmarkId: number,
    expectedKey: string,
    content: ForkContent,
    options: {
      mediaRef?: MediaSnapshotRef
      mediaInput?: PodcastSnapshotInput
      force?: boolean
      expectedUpdatedAt?: Date
      fields?: Prisma.sr_bookmarkUpdateManyMutationInput
    } = {}
  ) {
    return this.client().$transaction(async db => {
      if (options.mediaRef) await this.assertMediaPolicy(db, options.mediaRef, options.force)
      if (options.mediaInput && !(await this.matchesMediaInput(db, options.mediaInput))) return false
      const updated = await db.sr_bookmark.updateMany({
        where: {
          id: bookmarkId,
          content_key: expectedKey,
          ...(options.force ? {} : { moderation_result: 0 }),
          ...(options.expectedUpdatedAt ? { updated_at: options.expectedUpdatedAt } : { status: 'success' })
        },
        data: { ...options.fields, ...content, updated_at: new Date() }
      })
      if (updated.count !== 1) return false
      if (options.mediaRef) {
        const raw = await db.sr_bookmark.findUniqueOrThrow({ where: { id: bookmarkId } })
        await db.sr_media_article_ref.upsert({
          where: { bookmark_id: bookmarkId },
          create: { ...options.mediaRef, bookmark_id: bookmarkId, user_id: raw.private_user },
          update: options.mediaRef
        })
      }
      return true
    })
  }
}
