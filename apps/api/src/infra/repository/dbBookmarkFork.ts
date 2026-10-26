import { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { BookmarkNotFoundError } from '@/const/err'
import { ErrorName } from '@slax-reader/contracts'
import { forkError } from '@/utils/bookmarkForkError'
import { podcastInputFingerprint, type PodcastSnapshotInput } from '@/utils/mediaSnapshot'

type Database = Prisma.TransactionClient
export type MediaSnapshotRef = {
  media_kind: string
  source_id: string
  source_hash: string
}
export type ForkSource = NonNullable<Awaited<ReturnType<BookmarkForkRepo['source']>>>
export type ForkContent = {
  content_key: string
  content_md_key: string
  content_word_count: number
}
export type ForkPersonalState = {
  savedAt?: Date
  starred?: boolean
  archived?: boolean
}
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
  destination?: { id: number; bookmark_id: number; updated_at: Date; requireLive?: boolean }
}

/** Convert only an explicitly saved historical relation; preserve its public identity and personal references. */
export async function privatizeLegacyBookmark(db: Database, userId: number, targetUrl: string) {
  const legacy = await db.sr_user_bookmark.findFirst({
    where: {
      user_id: userId,
      bookmark: { target_url: targetUrl, private_user: 0 }
    },
    include: { bookmark: true }
  })
  if (!legacy) return null
  await db.$queryRaw`SELECT id FROM sr_user_bookmark WHERE id = ${legacy.id} FOR UPDATE`
  const fresh = await db.sr_user_bookmark.findUnique({
    where: { id: legacy.id },
    include: { bookmark: true }
  })
  if (!fresh || fresh.bookmark_id !== legacy.bookmark_id) return null
  const { id: _id, uuid: _uuid, ...fields } = legacy.bookmark
  const uuid = crypto.randomUUID()
  // The relation UUID may already name a shared file. A fresh UUID in the same
  // conventional directory prevents overwriting that file for other readers.
  const pdf = fields.content_key.startsWith('pdf/body/')
  const bookmark = await db.sr_bookmark.create({
    data: {
      ...fields,
      uuid,
      private_user: userId,
      content_key: legacy.type === 1 ? '' : pdf ? `pdf/body/${uuid}.pdf` : `html/body/${uuid}.html`,
      content_md_key: '',
      status: 'failed',
      updated_at: new Date()
    }
  })
  await db.sr_user_bookmark.update({
    where: { id: legacy.id },
    data: {
      bookmark_id: bookmark.id,
      updated_at: new Date(),
      metadata: {
        ...(legacy.metadata as Prisma.JsonObject),
        bookmark: JSON.parse(JSON.stringify(bookmark))
      }
    }
  })
  await db.sr_user_bookmark_tag.updateMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id },
    data: { bookmark_id: bookmark.id }
  })
  await db.sr_user_delete_bookmark.updateMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id },
    data: { bookmark_id: bookmark.id }
  })
  await db.sr_bookmark_share.updateMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id },
    data: { bookmark_id: bookmark.id }
  })
  await db.sr_bookmark_import_relation.updateMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id },
    data: { bookmark_id: bookmark.id }
  })
  await db.sr_bookmark_summary.deleteMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id }
  })
  await db.sr_user_bookmark_overview.deleteMany({
    where: { user_id: userId, bookmark_id: legacy.bookmark_id }
  })
  return db.sr_user_bookmark.findUniqueOrThrow({
    where: { id: legacy.id },
    include: { bookmark: true }
  })
}

@injectable()
export class BookmarkForkRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private client: LazyInstance<PrismaClient>) {}

  async source(viewer: number, uuid: string, db: Database = this.client()) {
    const relation = await db.sr_user_bookmark.findUnique({ where: { uuid }, include: { bookmark: true } })
    if (!relation?.bookmark) return null
    const [ownerResult, shareResult] = await Promise.allSettled([
      db.sr_user.findUnique({ where: { id: relation.user_id } }),
      db.sr_bookmark_share.findUnique({ where: { bookmark_id_user_id: { bookmark_id: relation.bookmark_id, user_id: relation.user_id } } })
    ])
    if (ownerResult.status === 'rejected') throw ownerResult.reason
    const owner = ownerResult.value
    if (!owner || owner.deleted_at) return null
    if (shareResult.status === 'rejected') throw shareResult.reason
    const share = shareResult.value
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
    if (!['success', 'failed'].includes(raw.status)) throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
    return relation
  }

  async existing(userId: number, targetUrl: string) {
    return this.client().$transaction(async db => {
      const existing = await this.destination(userId, targetUrl, db)
      return existing ?? (await privatizeLegacyBookmark(db, userId, targetUrl)) ?? this.destination(userId, targetUrl, db)
    })
  }

  async claimWrite(bookmarkId: number, revision: Date, statuses: string[] = ['success'], force = false) {
    // Keep the status predicate inside the UPDATE; relational Prisma updateMany can preselect IDs.
    return (
      (await this.client().$executeRaw`
      UPDATE sr_bookmark SET status = 'parseing'
      WHERE id = ${bookmarkId} AND updated_at = ${revision} AND status IN (${Prisma.join(statuses)})
        AND (${force} OR moderation_result = 0)
        AND EXISTS (SELECT 1 FROM sr_user_bookmark WHERE bookmark_id = sr_bookmark.id)
    `) === 1
    )
  }

  async ownsWrite(bookmarkId: number, revision: Date, relation?: { id: number; uuid: string; user_id: number }) {
    return !!(await this.client().sr_bookmark.findFirst({
      where: {
        id: bookmarkId,
        updated_at: revision,
        status: 'parseing',
        userBookmarks: { some: relation ? { ...relation, deleted_at: null } : {} }
      },
      select: { id: true }
    }))
  }

  async releaseWrite(bookmarkId: number, revision: Date, publishedUpdatedAt = new Date(Math.max(Date.now(), revision.getTime() + 1))) {
    return (
      (
        await this.client().sr_bookmark.updateMany({
          where: { id: bookmarkId, updated_at: revision, status: 'parseing' },
          data: { status: 'success', updated_at: publishedUpdatedAt }
        })
      ).count === 1
    )
  }

  async failDispatch(bookmarkId: number, revision: Date) {
    return (
      (
        await this.client().sr_bookmark.updateMany({
          where: {
            id: bookmarkId,
            updated_at: revision,
            status: { in: ['pending', 'pending_retry'] }
          },
          data: { status: 'failed' }
        })
      ).count === 1
    )
  }

  async failWrite(bookmarkId: number, revision: Date) {
    return (
      (
        await this.client().sr_bookmark.updateMany({
          where: {
            id: bookmarkId,
            updated_at: revision,
            status: { in: ['parseing'] }
          },
          data: { status: 'failed' }
        })
      ).count === 1
    )
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

  private async validateSource(db: Database, userId: number, source: ForkSource) {
    // Keep source identity and access stable until the transaction commits.
    await db.$queryRaw`SELECT id FROM sr_user WHERE id IN (${userId}, ${source.user_id}) FOR SHARE`
    await db.$queryRaw`SELECT id FROM sr_user_bookmark WHERE id = ${source.id} FOR SHARE`
    await db.$queryRaw`SELECT id FROM sr_bookmark WHERE id = ${source.bookmark_id} FOR SHARE`
    await db.$queryRaw`SELECT id FROM sr_bookmark_share WHERE bookmark_id = ${source.bookmark_id} AND user_id = ${source.user_id} FOR SHARE`
    const user = await db.sr_user.findUnique({ where: { id: userId } })
    const current = await this.source(userId, source.uuid, db)
    if (!user || user.deleted_at || !current || current.id !== source.id || current.bookmark_id !== source.bookmark_id) throw BookmarkNotFoundError()
    const before = source.bookmark
    const after = current.bookmark
    if (
      current.type !== source.type ||
      (current.metadata as Prisma.JsonObject)?.pdf_document_id !== (source.metadata as Prisma.JsonObject)?.pdf_document_id ||
      after.target_url !== before.target_url ||
      after.content_key !== before.content_key ||
      after.content_md_key !== before.content_md_key ||
      after.status !== 'success' ||
      after.moderation_result !== before.moderation_result ||
      after.updated_at.getTime() !== before.updated_at.getTime()
    )
      throw forkError()

    return current
  }

  /** Admission and the private write claim commit together, before any R2 operation. */
  async admit(input: { userId: number; source: ForkSource; targetUrl: string; uuid: string }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client().$transaction(
          async db => {
            const source = await this.validateSource(db, input.userId, input.source)
            let raw = await db.sr_bookmark.findUnique({ where: { target_url_private_user: { target_url: input.targetUrl, private_user: input.userId } } })
            if (!raw) raw = (await privatizeLegacyBookmark(db, input.userId, input.targetUrl))?.bookmark ?? null
            if (raw) {
              await db.$queryRaw`SELECT id FROM sr_bookmark WHERE id = ${raw.id} FOR UPDATE`
              const relation = await db.sr_user_bookmark.findUnique({ where: { user_id_bookmark_id: { user_id: input.userId, bookmark_id: raw.id } }, include: { bookmark: true } })
              if (!relation) throw forkError(ErrorName.FORK_DESTINATION_DELETING)
              if (!['success', 'failed'].includes(relation.bookmark.status)) {
                if (!relation.deleted_at && relation.forked_from_id === source.id) return { disposition: 'already_saved' as const, relation }
                throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
              }
              const now = new Date(Math.max(Date.now(), relation.bookmark.updated_at.getTime() + 1))
              await db.sr_bookmark.update({ where: { id: raw.id }, data: { status: 'parseing', updated_at: now } })
              // Preserve the existing body's attribution until successful publication.
              const restored = await this.restore(db, { ...relation, bookmark: { ...relation.bookmark, status: 'parseing', updated_at: now } })
              return { disposition: 'updated' as const, relation: restored }
            }
            const before = source.bookmark
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
                status: 'parseing',
                created_at: now,
                updated_at: now
              }
            })
            const relation = await db.sr_user_bookmark.create({
              data: {
                uuid: input.uuid,
                user_id: input.userId,
                bookmark_id: bookmark.id,
                forked_from_id: source.id,
                type: source.type,
                updated_at: now
              },
              include: { bookmark: true }
            })
            return { disposition: 'created' as const, relation }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }
        )
      } catch (error) {
        // A competing private-URL insert/claim wins; reload it without changing its timestamp.
        if (attempt >= 2 || !['P2002', 'P2034'].includes((error as { code?: string }).code ?? '')) throw error
      }
    }
  }

  async viewerStatus(userId: number, sourceId: number, targetUrl: string): Promise<'pending' | 'success' | 'failed' | null> {
    const relation = await this.client().sr_user_bookmark.findFirst({
      where: { user_id: userId, deleted_at: null, bookmark: { target_url: targetUrl, private_user: userId } },
      include: { bookmark: true }
    })
    if (!relation) return null
    const status = relation.bookmark.status
    if (['pending', 'pending_retry', 'parseing', 'retrying', 'pending_import'].includes(status)) return 'pending'
    if (status === 'failed') return 'failed'
    return status === 'success' && relation.forked_from_id === sourceId ? 'success' : null
  }

  async publish(input: ForkPublication) {
    return this.client().$transaction(
      async db => {
        if (input.mediaRef) await this.assertMediaPolicy(db, input.mediaRef)
        if (input.mediaInput && !(await this.matchesMediaInput(db, input.mediaInput))) throw forkError()
        const current = await this.validateSource(db, input.userId, input.source)
        const before = input.source.bookmark

        const existing = input.destination ? null : await this.destination(input.userId, input.targetUrl, db)
        if (existing)
          return {
            disposition: 'already_saved' as const,
            relation: await this.restore(db, existing)
          }

        const now = new Date(Math.max(Date.now(), (input.destination?.updated_at.getTime() ?? 0) + 1))
        if (input.destination) {
          await db.$queryRaw`SELECT id FROM sr_bookmark WHERE id = ${input.destination.bookmark_id} FOR UPDATE`
          const changed = await db.sr_bookmark.updateMany({
            where: {
              id: input.destination.bookmark_id,
              private_user: input.userId,
              target_url: input.targetUrl,
              status: 'parseing',
              updated_at: input.destination.updated_at,
              userBookmarks: {
                some: {
                  id: input.destination.id,
                  user_id: input.userId,
                  uuid: input.uuid,
                  ...(input.destination.requireLive ? { deleted_at: null } : {})
                }
              }
            },
            data: {
              title: before.title,
              host_url: before.host_url,
              site_name: before.site_name,
              content_icon: before.content_icon,
              content_cover: before.content_cover,
              description: before.description,
              byline: before.byline,
              published_at: before.published_at,
              moderation_result: before.moderation_result,
              ...input.content,
              status: 'success',
              updated_at: now
            }
          })
          if (changed.count !== 1) throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
          let relation = await db.sr_user_bookmark.update({
            where: { id: input.destination.id },
            data: {
              forked_from_id: current.id,
              type: current.type,
              updated_at: now
            },
            include: { bookmark: true }
          })
          if (input.pdfDocumentId) {
            await db.$executeRaw`UPDATE sr_user_bookmark SET metadata = metadata || jsonb_build_object('pdf_document_id', ${input.pdfDocumentId}::text) WHERE id = ${relation.id}`
            relation = (await db.sr_user_bookmark.findUnique({
              where: { id: relation.id },
              include: { bookmark: true }
            }))!
          }
          if (input.mediaRef)
            await db.sr_media_article_ref.upsert({
              where: { bookmark_id: relation.bookmark_id },
              create: {
                ...input.mediaRef,
                bookmark_id: relation.bookmark_id,
                user_id: input.userId
              },
              update: input.mediaRef
            })
          else
            await db.sr_media_article_ref.deleteMany({
              where: { bookmark_id: relation.bookmark_id }
            })
          return {
            disposition: 'updated' as const,
            relation: await this.restore(db, relation)
          }
        }
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

  async snapshot(bookmarkId: number) {
    return this.client().sr_bookmark.findUnique({ where: { id: bookmarkId }, include: { userBookmarks: { take: 1, select: { uuid: true, user_id: true } } } })
  }

  async setCaptureStatus(bookmarkId: number, revision: Date, status: string) {
    return (
      (
        await this.client().sr_bookmark.updateMany({
          where: {
            id: bookmarkId,
            updated_at: revision,
            status: {
              in: status === 'failed' ? ['pending', 'pending_retry', 'parseing'] : ['pending', 'pending_retry']
            }
          },
          data: { status }
        })
      ).count === 1
    )
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
      publishedUpdatedAt?: Date
      fields?: Prisma.sr_bookmarkUpdateManyMutationInput
      /** Only independent owner acquisition may replace the content's provenance. */
      clearForkProvenance?: boolean
    } = {}
  ) {
    return this.client().$transaction(async db => {
      if (options.mediaRef) await this.assertMediaPolicy(db, options.mediaRef, options.force)
      if (options.mediaInput && !(await this.matchesMediaInput(db, options.mediaInput))) return false
      await db.$queryRaw`SELECT id FROM sr_bookmark WHERE id = ${bookmarkId} FOR UPDATE`
      const updated = await db.sr_bookmark.updateMany({
        where: {
          id: bookmarkId,
          content_key: expectedKey,
          ...(options.force ? {} : { moderation_result: 0 }),
          status: 'parseing',
          userBookmarks: { some: {} },
          ...(options.expectedUpdatedAt ? { updated_at: options.expectedUpdatedAt } : {})
        },
        data: {
          ...options.fields,
          ...content,
          status: 'success',
          updated_at: options.publishedUpdatedAt ?? new Date(Math.max(Date.now(), (options.expectedUpdatedAt?.getTime() ?? 0) + 1))
        }
      })
      if (updated.count !== 1) return false
      if (options.mediaRef || options.clearForkProvenance) {
        const raw = await db.sr_bookmark.findUniqueOrThrow({ where: { id: bookmarkId } })
        if (options.clearForkProvenance && raw.private_user > 0) {
          await db.sr_user_bookmark.updateMany({
            where: { bookmark_id: bookmarkId, user_id: raw.private_user, forked_from_id: { not: null } },
            data: { forked_from_id: null, updated_at: new Date() }
          })
        }
        if (options.mediaRef) {
          await db.sr_media_article_ref.upsert({
            where: { bookmark_id: bookmarkId },
            create: { ...options.mediaRef, bookmark_id: bookmarkId, user_id: raw.private_user },
            update: options.mediaRef
          })
        }
      }
      return true
    })
  }
}
