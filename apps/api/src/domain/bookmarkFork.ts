import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ErrorName, type BookmarkForkMetadata, type ForkBookmarkResponse } from '@slax-reader/contracts'
import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { BookmarkNotFoundError, ErrorParam, UnauthorizedError } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { ContextManager } from '@/utils/context'
import { BookmarkForkRepo, type ForkContent, type ForkSource, type ForkPersonalState } from '@/infra/repository/dbBookmarkFork'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BucketClient } from '@/infra/repository/bucketClient'
import { SearchService } from './search'
import { LabService } from './lab'
import { forkError } from '@/utils/bookmarkForkError'
import { SnapshotBundle, snapshotKeys } from '@/utils/snapshotBundle'
import { MediaSnapshotService } from './mediaSnapshot'
import { NotificationMessage } from '@/infra/message/notification'
import { SnapshotCleanupRepo } from '@/infra/repository/dbSnapshotCleanup'

export type CompletedFork = ForkBookmarkResponse & { bookmark_id: number }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@injectable()
export class BookmarkForkService {
  constructor(
    @inject(BookmarkForkRepo) private repo: BookmarkForkRepo,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(LabService) private labs: LabService,
    @inject(SearchService) private search: SearchService,
    @inject(BookmarkRepo) private bookmarks: BookmarkRepo,
    @inject(MediaSnapshotService) private media: MediaSnapshotService,
    @inject(NotificationMessage) private notifications: NotificationMessage,
    @inject(SnapshotCleanupRepo) private cleanup: SnapshotCleanupRepo
  ) {}

  async fork(ctx: ContextManager, sourceUuid: string, personal?: ForkPersonalState): Promise<CompletedFork> {
    const userId = ctx.getUserId()
    if (!userId) throw UnauthorizedError()
    if (typeof sourceUuid !== 'string' || !uuidPattern.test(sourceUuid)) throw ErrorParam()
    const source = await this.repo.source(userId, sourceUuid.toLowerCase())
    if (!source) throw BookmarkNotFoundError()
    await this.labs.assertUrlAllowed(ctx, source.bookmark.target_url)
    const pdf = isPdfContentKey(source.bookmark.content_key)
    if (pdf) await this.labs.assertEnabled(ctx, 'pdf')
    if (source.user_id === userId) return this.existingResult(ctx, await this.repo.ownSource(userId, sourceUuid))

    const targetUrl = this.destinationUrl(source, userId)
    const existing = await this.repo.existing(userId, targetUrl)
    if (existing) return this.existingResult(ctx, existing)
    if (source.bookmark.status !== 'success') throw forkError()

    const uuid = crypto.randomUUID()
    const bundle = new SnapshotBundle(this.bucket().R2Bucket, uuid, key => this.cleanup.registerBundle(key))
    let publicationStarted = false
    let result: Awaited<ReturnType<BookmarkForkRepo['publish']>>
    try {
      const content =
        source.type === 1
          ? { content_key: '', content_md_key: '', content_word_count: 0 }
          : pdf
            ? await this.copyPdf(source, bundle)
            : await bundle.copyHtml(source.bookmark.content_key)
      const copiedMedia = source.type !== 1 && !pdf ? await this.media.copyForFork(source.bookmark, bundle) : undefined
      if (copiedMedia) await this.labs.assertEnabled(ctx, copiedMedia.ref.media_kind === 'podcast' ? 'podcast' : 'youtube')
      await bundle.assertUnchanged()
      publicationStarted = true
      result = await this.repo.publish({
        userId,
        source,
        targetUrl,
        uuid,
        content,
        personal,
        mediaRef: copiedMedia?.ref,
        mediaInput: copiedMedia?.input,
        pdfDocumentId: pdf ? this.documentId(source) : undefined
      })
    } catch (error) {
      if (!publicationStarted || error instanceof MultiLangError) {
        await bundle.discard().catch(() => {})
        throw error
      }
      // A disconnected COMMIT may have succeeded. Read authoritative pointers before
      // considering cleanup; a failed read or absent row cannot prove rollback.
      let winner: Awaited<ReturnType<BookmarkForkRepo['reconcile']>>
      try {
        winner = await this.repo.reconcile(userId, targetUrl)
      } catch {
        throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      }
      if (winner?.uuid === uuid) {
        result = { disposition: 'created', relation: winner }
      } else {
        const code = (error as { code?: string }).code
        if (code === 'P2002' || code === 'P2034') {
          await bundle.discard().catch(() => {})
          if (winner) return this.existingResult(ctx, winner)
        }
        throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      }
    }

    if (result.disposition === 'already_saved') {
      await bundle.discard().catch(() => {})
      return this.existingResult(ctx, result.relation)
    }
    // Side effects are outside the rollback scope. Failures must never delete a live bundle.
    await this.afterCommit(ctx, result.relation).catch(error => console.error('Fork indexing failed', error))
    return this.result(result.relation, result.disposition)
  }

  private async existingResult(ctx: ContextManager, relation: { uuid: string; bookmark_id: number }) {
    await this.search.clearSearchCache(ctx, ctx.getUserId()).catch(error => console.error('Fork cache clearing failed', error))
    return this.result(relation, 'already_saved')
  }

  private result(relation: { uuid: string; bookmark_id: number }, disposition: ForkBookmarkResponse['disposition']): CompletedFork {
    return { bookmark_uid: relation.uuid, bookmark_id: relation.bookmark_id, disposition }
  }

  /** Read-only Reader-tab resolution; opening the extension never restores or creates a save. */
  async lookup(ctx: ContextManager, sourceUuid: string) {
    const source = await this.repo.source(ctx.getUserId(), sourceUuid)
    if (!source) return null
    if (source.user_id === ctx.getUserId()) return source.deleted_at ? null : source
    try {
      const destination = await this.repo.destination(ctx.getUserId(), this.destinationUrl(source, ctx.getUserId()))
      return destination?.deleted_at ? null : destination
    } catch (error) {
      if (error instanceof MultiLangError) return null
      throw error
    }
  }

  private documentId(source: ForkSource) {
    const metadata = source.metadata as Record<string, unknown>
    const value = metadata?.pdf_document_id
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw forkError()
    return value
  }

  private destinationUrl(source: ForkSource, userId: number) {
    if (!source.bookmark.target_url.startsWith('slax-pdf:')) return source.bookmark.target_url
    const documentId = this.documentId(source)
    if (!new RegExp(`^slax-pdf://[0-9]+/${documentId}$`).test(source.bookmark.target_url)) throw forkError()
    return `slax-pdf://${userId}/${documentId}`
  }

  private async copyPdf(source: ForkSource, bundle: SnapshotBundle): Promise<ForkContent> {
    const key = source.bookmark.content_key
    const keys = snapshotKeys(bundle.uuid, bundle.attempt, true)
    const binary = await bundle.copy(key, keys.content_key)
    if (binary.customMetadata?.sha256 !== this.documentId(source)) throw forkError()
    const state = await (await bundle.read(key.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json'))).json<{ text_status: string; pages: number }>()
    if (!['ready', 'empty', 'failed'].includes(state.text_status) || (state.text_status === 'ready') !== !!source.bookmark.content_md_key) throw forkError()
    await bundle.put(keys.sidecar, JSON.stringify({ text_status: state.text_status, pages: state.pages }), { contentType: 'application/json' })
    if (state.text_status === 'ready') await bundle.copy(source.bookmark.content_md_key, keys.content_md_key)
    return { content_key: keys.content_key, content_md_key: state.text_status === 'ready' ? keys.content_md_key : '', content_word_count: source.bookmark.content_word_count }
  }

  async metadata(ctx: ContextManager, uuid: string): Promise<BookmarkForkMetadata> {
    if (!uuidPattern.test(uuid)) throw ErrorParam()
    const destination = await this.repo.source(ctx.getUserId(), uuid)
    if (!destination) throw BookmarkNotFoundError()
    const result: BookmarkForkMetadata = {
      has_fork: destination.forked_from_id !== null,
      can_fork: destination.user_id !== ctx.getUserId() && destination.bookmark.status === 'success',
      fork: null
    }
    if (!destination.forked_from_id) return result
    result.fork = { status: 'unavailable' }
    const source = await this.repo.sourceById(ctx.getUserId(), destination.forked_from_id)
    if (!source) return result
    let isSame = source.bookmark.target_url === destination.bookmark.target_url
    if (!isSame && source.bookmark.target_url.startsWith('slax-pdf://')) {
      try {
        isSame = this.destinationUrl(source, destination.user_id) === destination.bookmark.target_url && this.documentId(source) === this.documentId(destination)
      } catch {
        return result
      }
    }
    if (!isSame) return result
    const showUser = source.user_id === ctx.getUserId() || !source.share || source.share.show_userinfo
    result.fork = { status: 'available', source_bookmark_uid: source.uuid, display_name: showUser ? source.owner.name : null }
    return result
  }

  private async afterCommit(ctx: ContextManager, relation: Awaited<ReturnType<BookmarkForkRepo['publish']>>['relation']) {
    const raw = relation.bookmark
    const changedAt = new Date()
    const outcomes = await Promise.allSettled([
      this.media.repairIndex(ctx, raw.id),
      this.search.clearSearchCache(ctx, ctx.getUserId()),
      this.bookmarks.createBookmarkChangeLog(ctx.getUserId(), raw.target_url, raw.id, 'add', changedAt),
      this.notifications.sendBookmarkChange(ctx.env, {
        user_id: ctx.getUserId(),
        bookmark_id: ctx.hashIds.encodeId(raw.id),
        target_url: raw.target_url,
        action: 'add',
        created_at: changedAt
      })
    ])
    if (outcomes.some(outcome => outcome.status === 'rejected')) console.error('Fork committed; deferred side effects require recovery', { bookmarkId: raw.id })
  }
}
