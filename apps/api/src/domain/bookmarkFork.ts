import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ErrorName, type BookmarkForkMetadata } from '@slax-reader/contracts'
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

export type ForkWorkflowJob = {
  sourceUuid: string
  sourceId: number
  sourceBookmarkId: number
  sourceRevision: string
  sourceType: number
  destinationUuid: string
  destinationId: number
  revision: string
  created: boolean
}

export type CompletedFork = { bookmark_uid: string; disposition: 'created' | 'already_saved' | 'updated'; bookmark_id: number }
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
    @inject(NotificationMessage) private notifications: NotificationMessage
  ) {}

  async admit(ctx: ContextManager, sourceUuid: string, clientUuid?: string): Promise<CompletedFork> {
    const userId = ctx.getUserId()
    if (!userId) throw UnauthorizedError()
    if (typeof sourceUuid !== 'string' || !uuidPattern.test(sourceUuid)) throw ErrorParam()
    if (clientUuid !== undefined && !uuidPattern.test(clientUuid)) throw ErrorParam()
    const source = await this.repo.source(userId, sourceUuid.toLowerCase())
    if (!source) throw BookmarkNotFoundError()
    const checks = await Promise.allSettled([
      this.labs.assertUrlAllowed(ctx, source.bookmark.target_url),
      isPdfContentKey(source.bookmark.content_key) ? this.labs.assertEnabled(ctx, 'pdf') : Promise.resolve(),
      this.assertMediaAllowed(ctx, source.bookmark_id)
    ])
    // Preserve validation priority and require every gate before creating a write claim.
    for (const check of checks) if (check.status === 'rejected') throw check.reason
    if (source.user_id === userId) return this.existingResult(ctx, await this.repo.ownSource(userId, sourceUuid))
    if (source.bookmark.status !== 'success') throw forkError()
    const admission = await this.repo.admit({ userId, source, targetUrl: this.destinationUrl(source, userId), uuid: clientUuid ?? crypto.randomUUID() })
    const { relation, disposition } = admission
    const revision = relation.bookmark.updated_at
    const workflowId = `fork-${relation.bookmark_id}-${revision.getTime()}`
    if (disposition === 'already_saved') {
      await this.confirmDispatch(ctx, workflowId, relation.bookmark_id, revision)
    } else {
      const fork: ForkWorkflowJob = {
        sourceUuid: source.uuid,
        sourceId: source.id,
        sourceBookmarkId: source.bookmark_id,
        sourceRevision: source.bookmark.updated_at.toISOString(),
        sourceType: source.type,
        destinationUuid: relation.uuid,
        destinationId: relation.id,
        revision: revision.toISOString(),
        created: disposition === 'created'
      }
      try {
        await ctx.env.CRAWL_WORKFLOW.create({
          id: workflowId,
          params: { url: relation.bookmark.target_url, bookmarkId: relation.bookmark_id, userId, enUserId: ctx.getEncodeUserId(), userLang: ctx.getlang(), fork }
        })
      } catch {
        await this.confirmDispatch(ctx, workflowId, relation.bookmark_id, revision)
      }
    }
    await this.search.clearSearchCache(ctx, userId).catch(error => console.error('Fork cache clearing failed', error))
    return this.result(relation, disposition)
  }

  private async confirmDispatch(ctx: ContextManager, workflowId: string, bookmarkId: number, revision: Date) {
    // Neither a duplicate admission nor a lost create response proves dispatch.
    // An unavailable lookup cannot prove that no fixed-key writer is active.
    let status: string | undefined
    try {
      status = (await (await ctx.env.CRAWL_WORKFLOW.get(workflowId)).status()).status
    } catch {}
    if (status === 'errored' || status === 'terminated') await this.repo.failWrite(bookmarkId, revision)
    if (!status || !['queued', 'running', 'paused', 'waiting', 'waitingForPause', 'complete'].includes(status)) throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
  }

  /** Called only by the deterministic Workflow; retries retain the same admitted claim. */
  async execute(ctx: ContextManager, bookmarkId: number, job: ForkWorkflowJob) {
    const revision = new Date(job.revision)
    const ownsWrite = () => this.repo.ownsWrite(bookmarkId, revision, { id: job.destinationId, uuid: job.destinationUuid, user_id: ctx.getUserId() })
    if (!(await ownsWrite())) {
      await this.repo.failWrite(bookmarkId, revision)
      return
    }
    const source = await this.repo.source(ctx.getUserId(), job.sourceUuid)
    if (
      !source ||
      source.id !== job.sourceId ||
      source.bookmark_id !== job.sourceBookmarkId ||
      source.bookmark.updated_at.toISOString() !== job.sourceRevision ||
      source.bookmark.status !== 'success' ||
      source.type !== job.sourceType
    )
      throw forkError()
    await this.labs.assertUrlAllowed(ctx, source.bookmark.target_url)
    const pdf = isPdfContentKey(source.bookmark.content_key)
    if (pdf) await this.labs.assertEnabled(ctx, 'pdf')
    await this.assertMediaAllowed(ctx, source.bookmark_id)
    const raw = await this.repo.snapshot(bookmarkId)
    if (!raw || !(await ownsWrite())) {
      await this.repo.failWrite(bookmarkId, revision)
      return
    }
    const storageUuid = raw.content_key?.match(/^(?:html|pdf)\/body\/([^/]+)\.(?:html|pdf)$/)?.[1] ?? job.destinationUuid
    const bundle = new SnapshotBundle(this.bucket().R2Bucket, storageUuid, crypto.randomUUID(), {
      deleteNewObjectsOnDiscard: job.created,
      beforeWrite: async () => {
        if (!(await ownsWrite())) throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
      }
    })
    let publishing = false
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
      publishing = true
      const result = await this.repo.publish({
        userId: ctx.getUserId(),
        source,
        targetUrl: this.destinationUrl(source, ctx.getUserId()),
        uuid: job.destinationUuid,
        content,
        destination: { id: job.destinationId, bookmark_id: bookmarkId, updated_at: revision, requireLive: true },
        mediaRef: copiedMedia?.ref,
        mediaInput: copiedMedia?.input,
        pdfDocumentId: pdf ? this.documentId(source) : undefined
      })
      await this.afterCommit(ctx, result.relation).catch(error => console.error('Fork indexing failed', error))
    } catch (error) {
      // Unknown COMMIT outcomes may own these keys; only known rollback permits discard.
      // The Workflow retries with the same claim; exhausted retries alone mark it failed.
      if ((!publishing || error instanceof MultiLangError) && (await ownsWrite())) await bundle.discard().catch(() => {})
      throw error
    }
  }

  private async assertMediaAllowed(ctx: ContextManager, bookmarkId: number) {
    const ref = await this.repo.mediaRef(bookmarkId)
    if (ref) await this.labs.assertEnabled(ctx, ref.media_kind === 'podcast' ? 'podcast' : 'youtube')
  }

  async failExecution(bookmarkId: number, job: ForkWorkflowJob) {
    await this.repo.failWrite(bookmarkId, new Date(job.revision))
  }

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
    if (source.bookmark.status !== 'success') throw forkError()
    const existing = await this.repo.existing(userId, targetUrl)

    if (existing && !(await this.repo.claimWrite(existing.bookmark_id, existing.bookmark.updated_at, ['success', 'failed'], true)))
      throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
    const uuid = existing?.uuid ?? crypto.randomUUID()
    const storageUuid = existing?.bookmark.content_key?.match(/^(?:html|pdf)\/body\/([^/]+)\.(?:html|pdf)$/)?.[1] ?? uuid
    const bundle = new SnapshotBundle(this.bucket().R2Bucket, storageUuid, crypto.randomUUID(), { deleteNewObjectsOnDiscard: !existing })
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
        destination: existing
          ? {
              id: existing.id,
              bookmark_id: existing.bookmark_id,
              updated_at: existing.bookmark.updated_at
            }
          : undefined,
        mediaRef: copiedMedia?.ref,
        mediaInput: copiedMedia?.input,
        pdfDocumentId: pdf ? this.documentId(source) : undefined
      })
    } catch (error) {
      if (existing) {
        await this.repo.failWrite(existing.bookmark_id, existing.bookmark.updated_at).catch(() => {})
        if (error instanceof MultiLangError) throw error
        throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      }
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
          if (winner?.forked_from_id === source.id && winner.bookmark.status === 'success') return this.existingResult(ctx, winner)
        }
        throw forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      }
    }

    if (result.disposition === 'already_saved') {
      await bundle.discard().catch(() => {})
      if (result.relation.forked_from_id !== source.id || result.relation.bookmark.status !== 'success') throw forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS)
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

  private result(relation: { uuid: string; bookmark_id: number }, disposition: CompletedFork['disposition']): CompletedFork {
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

  private documentId(source: Pick<ForkSource, 'metadata'>) {
    const metadata = source.metadata as Record<string, unknown>
    const value = metadata?.pdf_document_id
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw forkError()
    return value
  }

  private destinationUrl(source: Pick<ForkSource, 'bookmark' | 'metadata'>, userId: number) {
    if (!source.bookmark.target_url.startsWith('slax-pdf:')) return source.bookmark.target_url
    const documentId = this.documentId(source)
    if (!new RegExp(`^slax-pdf://[0-9]+/${documentId}$`).test(source.bookmark.target_url)) throw forkError()
    return `slax-pdf://${userId}/${documentId}`
  }

  private async copyPdf(source: ForkSource, bundle: SnapshotBundle): Promise<ForkContent> {
    const key = source.bookmark.content_key
    const keys = snapshotKeys(bundle.uuid, true)
    const binary = await bundle.copy(key, keys.content_key)
    if (binary.customMetadata?.sha256 !== this.documentId(source)) throw forkError()
    const state = await (await bundle.read(key.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json'))).json<{ text_status: string; pages: number }>()
    if (!['ready', 'empty', 'failed'].includes(state.text_status) || (state.text_status === 'ready') !== !!source.bookmark.content_md_key) throw forkError()
    await bundle.put(keys.sidecar!, JSON.stringify({ text_status: state.text_status, pages: state.pages }), { contentType: 'application/json' })
    if (state.text_status === 'ready') await bundle.copy(source.bookmark.content_md_key, keys.content_md_key)
    return { content_key: keys.content_key, content_md_key: state.text_status === 'ready' ? keys.content_md_key : '', content_word_count: source.bookmark.content_word_count }
  }

  async metadata(ctx: ContextManager, destination: Pick<ForkSource, 'id' | 'user_id' | 'forked_from_id' | 'bookmark' | 'metadata'>): Promise<BookmarkForkMetadata> {
    const result: BookmarkForkMetadata = {
      has_fork: destination.forked_from_id != null,
      fork: null,
      viewer_fork_status: null
    }
    if (ctx.getUserId() && destination.user_id !== ctx.getUserId()) {
      try {
        result.viewer_fork_status = await this.repo.viewerStatus(ctx.getUserId(), destination.id, this.destinationUrl(destination, ctx.getUserId()))
      } catch (error) {
        if (!(error instanceof MultiLangError)) throw error
      }
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
    await this.bookmarks.deleteBookmarkSummary(raw.id, ctx.getUserId())
    const changedAt = new Date()
    const outcomes = await Promise.allSettled([
      this.media.indexSnapshot(ctx, raw.id),
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
