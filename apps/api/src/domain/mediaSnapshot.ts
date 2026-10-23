import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BookmarkNotFoundError } from '@/const/err'
import { BookmarkForkRepo, type MediaSnapshotRef } from '@/infra/repository/dbBookmarkFork'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { BucketClient } from '@/infra/repository/bucketClient'
import { MarkRepo } from '@/infra/repository/dbMark'
import { UserRepo } from '@/infra/repository/dbUser'
import { YoutubeArticleRepo } from '@/infra/repository/dbYoutubeArticle'
import { PodcastArticleRepo, PodcastEpisodeRepo, type podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import { eligibilityDecision, type mediaArticlePO } from '@/infra/repository/dbMediaArticle'
import { LabService } from './lab'
import { SearchService } from './search'
import { SnapshotBundle, loadEmbeddedSnapshot, readEmbeddedSnapshot } from '@/utils/snapshotBundle'
import {
  freezeMediaSnapshot,
  podcastInputFingerprint,
  type PodcastSnapshotInput,
  normalizedMediaContent,
  parseMediaSnapshot,
  privateMediaVersion,
  type MediaLanguage,
  type MediaSnapshot,
  type PrivateMediaVariant
} from '@/utils/mediaSnapshot'
import { youtubeArticleLanguage, youtubeArticleVersion, renderArticleText, type YoutubeArticleDocument } from '@/utils/youtubeArticle'
import { renderMediaArticle, renderPodcastBody, renderPodcastText, type PodcastPlayerInfo } from '@/utils/podcastArticle'
import { podcastLanguage } from '@/utils/podcastSource'
import { toCompatCues, type YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import type { PodcastCue, PodcastTranscriptDocument } from '@/utils/podcastTranscript'
import { HtmlBuilder } from '@/utils/htmlBuilder'
import type { ContextManager } from '@/utils/context'

type RawSnapshot = NonNullable<Awaited<ReturnType<BookmarkForkRepo['snapshot']>>>
export type LoadedMediaSnapshot = {
  raw: RawSnapshot
  media: MediaSnapshot | null
  managed: boolean
}
type Body = { html: string; text: string }

@injectable()
export class MediaSnapshotService {
  constructor(
    @inject(BookmarkForkRepo) private repo: BookmarkForkRepo,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(YoutubeArticleRepo) private youtube: YoutubeArticleRepo,
    @inject(PodcastArticleRepo) private podcasts: PodcastArticleRepo,
    @inject(PodcastEpisodeRepo) private episodes: PodcastEpisodeRepo,
    @inject(UserRepo) private users: UserRepo,
    @inject(LabService) private labs: LabService,
    @inject(MarkRepo) private marks: MarkRepo,
    @inject(BookmarkRepo) private bookmarks: BookmarkRepo,
    @inject(SearchService) private search: SearchService,
    @inject(BookmarkSearchRepo) private searchRepo: BookmarkSearchRepo
  ) {}

  async load(bookmarkId: number): Promise<LoadedMediaSnapshot | null> {
    const raw = await this.repo.snapshot(bookmarkId)
    if (!raw) return null
    const { managed, manifest } = await loadEmbeddedSnapshot(this.bucket().R2Bucket, raw.content_key)
    const media = managed ? parseMediaSnapshot(manifest) : null
    return { raw, media, managed }
  }

  ref(media: MediaSnapshot): MediaSnapshotRef {
    return { media_kind: media.kind, source_id: media.sourceId, source_hash: media.sourceHash }
  }

  async readable(media: MediaSnapshot) {
    return !(await this.repo.mediaDenied(this.ref(media)))
  }

  async allowsBody(bookmarkId: number) {
    const ref = await this.repo.mediaRef(bookmarkId)
    if (!ref || !(await this.repo.mediaDenied(ref))) return true
    if (ref.media_kind !== 'youtube') return false
    const loaded = await this.load(bookmarkId)
    if (!loaded) return false
    if (loaded.managed) return loaded.media?.policyDenied === true && loaded.media.bodyLanguage === null && !Object.values(loaded.media.variants).some(v => v.status === 'ready')
    const html = await (await this.bucket().R2Bucket.get(loaded.raw.content_key))?.text()
    return !!html && !html.includes('data-slax-derived="youtube-article"')
  }

  async denyYoutube(sourceId: string) {
    await this.repo.denyYoutube(sourceId)
  }
  async denyPodcast(sourceId: string) {
    await this.repo.denyPodcast(sourceId)
  }

  async stripDerived(bookmarkId: number, body: Body) {
    const loaded = await this.load(bookmarkId)
    if (!loaded?.media) return false
    const media = structuredClone(loaded.media)
    media.policyDenied = true
    media.bodyLanguage = null
    media.variants = {}
    return this.publish(loaded, media, body, undefined, true)
  }

  private async language(userId: number): Promise<MediaLanguage> {
    const user = await this.users.getInfoByUserId(userId)
    return youtubeArticleLanguage(user.ai_lang, user.lang)
  }

  async initialize(ref: MediaSnapshotRef, userId: number, player?: PodcastPlayerInfo, capturedEpisode?: podcastEpisodePO): Promise<MediaSnapshot> {
    const lang = await this.language(userId)
    const enabled = await this.labs.isEnabled(userId, ref.media_kind === 'youtube' ? 'youtube_article' : 'podcast')
    const episode = ref.media_kind === 'podcast' ? (capturedEpisode ?? (await this.episodes.findBySourceId(ref.source_id))) : null
    player ??= episode
      ? {
          audioUrl: episode.audio_url,
          title: episode.title,
          showName: episode.show_name,
          coverUrl: episode.cover_url,
          durationSec: episode.duration_sec,
          shownotes: episode.shownotes,
          language: podcastLanguage(episode.language)
        }
      : undefined
    const media: MediaSnapshot = {
      schema: 1,
      kind: ref.media_kind as MediaSnapshot['kind'],
      mode: 'capture',
      revision: '',
      sourceId: ref.source_id,
      sourceHash: ref.source_hash,
      inputFingerprint: episode ? await podcastInputFingerprint(episode) : ref.source_hash,
      defaultLanguage: lang,
      transcript: ref.media_kind === 'youtube' ? 'ready' : 'pending',
      bodyLanguage: null,
      variants: enabled ? { [lang]: { status: 'pending' } } : {},
      ...(player ? { player } : {})
    }
    // The original podcast language can become known only after transcription.
    if (episode && podcastLanguage(episode.language) && enabled) media.variants[podcastLanguage(episode.language)!] = { status: 'pending' }
    return media
  }

  /** Fork reads ready material directly; status endpoints can start work and must not be used here. */
  async copyForFork(raw: Pick<RawSnapshot, 'id' | 'content_key' | 'private_user'>, bundle: SnapshotBundle) {
    let media: MediaSnapshot | null
    let input: PodcastSnapshotInput | undefined
    const embedded = readEmbeddedSnapshot(await bundle.readHtml(raw.content_key))
    if (embedded.managed) {
      media = parseMediaSnapshot(embedded.manifest)
    } else {
      const ref = await this.repo.mediaRef(raw.id)
      media = ref ? await this.initialize(ref, raw.private_user || (await this.repo.snapshot(raw.id))!.userBookmarks[0].user_id) : null
      if (media) {
        // Historical sources expose any ready language; acquisition is never requested.
        if (Object.keys(media.variants).length) {
          media.variants = { en: { status: 'pending' }, zh: { status: 'pending' } }
          input = await this.collect(media, bundle)
        }
        const html = await bundle.readHtml(raw.content_key)
        for (const lang of ['en', 'zh'] as const) {
          if (media.variants[lang]?.status === 'ready' && html.includes(`data-article-version="${youtubeArticleVersion(media.sourceHash, lang, 1, 'v1')}"`))
            media.bodyLanguage = lang
        }
      }
    }
    if (media && !(await this.readable(media))) throw BookmarkNotFoundError()
    await bundle.write('media.json', JSON.stringify(media ? freezeMediaSnapshot(media, bundle.attempt) : { schema: 1, kind: 'html' }), 'application/json')
    return media ? { ref: this.ref(media), input } : undefined
  }

  /** Capture only the first terminal result, and only while its input identity still matches. */
  private async collect(media: MediaSnapshot, bundle: SnapshotBundle): Promise<PodcastSnapshotInput | undefined> {
    let input: PodcastSnapshotInput | undefined
    if (media.mode !== 'capture') return
    let rows: mediaArticlePO[]
    let cues = media.cues
    if (media.kind === 'youtube') {
      rows = await this.youtube.listForSource(media.sourceId, media.sourceHash)
    } else {
      const ep = await this.episodes.findBySourceId(media.sourceId)
      if (!ep || (await podcastInputFingerprint(ep)) !== media.inputFingerprint || (media.sourceHash && ep.transcript_hash !== media.sourceHash)) {
        this.stopPending(media, ep ? 'input_changed' : undefined)
        return
      }
      input = { sourceId: ep.source_id, fingerprint: media.inputFingerprint, transcriptHash: ep.transcript_hash }
      if (ep.transcript_status === 'failed' || ep.transcript_status === 'skipped') {
        if (media.transcript !== 'ready') {
          media.transcript = ep.transcript_status
          media.transcriptReason = ep.error_message?.split(':')[0] || undefined
        }
        this.stopPending(media)
        return input
      }
      if (ep.transcript_status !== 'ready' || !ep.transcript_hash || !ep.transcript_key) return
      media.sourceHash = ep.transcript_hash
      const hadTranscript = media.transcript === 'ready'
      media.transcript = 'ready'
      const transcript = await (await bundle.read(ep.transcript_key)).json<PodcastTranscriptDocument>()
      cues = transcript.cues
      if (!hadTranscript) {
        media.cues = transcript.cues
        if (media.player) media.player.language = transcript.language
      }
      if (!media.variants[transcript.language]) media.variants[transcript.language] = { status: 'pending' }
      rows = await this.podcasts.listForSource(media.sourceId, media.sourceHash)
    }
    for (const lang of ['en', 'zh'] as const) {
      if (media.variants[lang]?.status !== 'pending') continue
      const row = rows.find(r => r.target_language === lang)
      if (!row) continue
      const eligibility = row.eligibility_json as { reason_codes?: string[] } | null
      const variant: PrivateMediaVariant = { status: 'pending', eligibility: { decision: eligibilityDecision(row), reason_codes: eligibility?.reason_codes ?? [] } }
      if (['failed', 'skipped', 'stale', 'takedown'].includes(row.status)) {
        variant.status = row.status === 'failed' ? 'failed' : row.status === 'skipped' ? 'skipped' : 'unavailable'
        variant.reason = row.error_message?.split(':')[0] || undefined
      } else if (row.status === 'ready' && row.article_key) {
        const doc = await (await bundle.read(row.article_key)).json<YoutubeArticleDocument>()
        if (doc.language !== lang) throw new Error('Private variant language mismatch')
        if (media.kind === 'youtube' && row.caption_key) media.cues = (await (await bundle.read(row.caption_key)).json<YoutubeCaptionDocument>()).cues
        variant.status = 'ready'
        variant.document = doc
        variant.content = normalizedMediaContent(doc, cues ?? media.cues ?? [])
      }
      media.variants[lang] = variant
    }
    return input
  }

  private stopPending(media: MediaSnapshot, reason?: string) {
    if (media.transcript === 'pending') {
      media.transcript = 'unavailable'
      media.transcriptReason = reason
    }
    for (const variant of Object.values(media.variants))
      if (variant.status === 'pending') {
        variant.status = 'unavailable'
        variant.reason = reason
      }
  }

  /** Returns false for a completed/frozen request; callers keep the legacy path for unmanaged rows. */
  async settle(ctx: ContextManager, bookmarkId: number, loaded?: LoadedMediaSnapshot | null): Promise<boolean> {
    loaded = loaded === undefined ? await this.load(bookmarkId) : loaded
    if (!loaded?.media || loaded.media.mode !== 'capture' || !(await this.readable(loaded.media))) return false
    const media = structuredClone(loaded.media)
    if (media.transcript !== 'pending' && !Object.values(media.variants).some(v => v.status === 'pending')) return false
    const bundle = new SnapshotBundle(this.bucket().R2Bucket, loaded.raw.content_key.match(/^html\/body\/([^/]+)\.html$/)?.[1] ?? loaded.raw.userBookmarks[0].uuid)
    const input = await this.collect(media, bundle)
    if (JSON.stringify(media) === JSON.stringify(loaded.media)) return false
    const original = media.kind === 'podcast' ? media.player?.language : media.defaultLanguage
    if (
      original &&
      media.variants[original]?.status === 'ready' &&
      (media.kind === 'podcast' ||
        ((await this.labs.isEnabled(loaded.raw.private_user, 'youtube_article')) &&
          (await this.language(loaded.raw.private_user)) === original &&
          !(await this.marks.bodyHasMarks(bookmarkId, loaded.raw.private_user))))
    )
      media.bodyLanguage = original
    const published = await this.publish(loaded, media, undefined, bundle, false, input)
    if (published) await this.effects(ctx, bookmarkId).catch(error => console.error('Private media indexing failed', error))
    return published
  }

  async settleSource(ctx: ContextManager, kind: 'youtube' | 'podcast', sourceId: string, loaded?: Map<number, LoadedMediaSnapshot | null>) {
    const refs = kind === 'youtube' ? await this.youtube.listRefs(sourceId) : await this.podcasts.listEpisodeRefs(sourceId)
    let count = 0
    for (const ref of refs) {
      try {
        const snapshot = await this.load(ref.bookmark_id)
        loaded?.set(ref.bookmark_id, snapshot)
        if (await this.settle(ctx, ref.bookmark_id, snapshot)) {
          count++
          if (loaded) loaded.set(ref.bookmark_id, await this.load(ref.bookmark_id))
        }
      } catch (error) {
        loaded?.set(ref.bookmark_id, null)
        console.error('Private media settlement failed', {
          bookmarkId: ref.bookmark_id,
          error
        })
      }
    }
    return count
  }

  /** Explicit owner retry opens only that owner's revision; prior captures settle before requeue. */
  async openRequest(bookmarkId: number, language: MediaLanguage, transcript = false, episode?: podcastEpisodePO) {
    const loaded = await this.load(bookmarkId)
    if (!loaded?.media) return
    if (loaded.media.mode === 'fork') throw BookmarkNotFoundError()
    const media = structuredClone(loaded.media)
    const recoveringInput =
      episode && media.kind === 'podcast' && (media.transcriptReason === 'input_changed' || Object.values(media.variants).some(variant => variant.reason === 'input_changed'))
    let input: PodcastSnapshotInput | undefined
    if (episode && media.kind === 'podcast') {
      media.inputFingerprint = await podcastInputFingerprint(episode)
      media.sourceHash = episode.transcript_hash ?? ''
      input = {
        sourceId: episode.source_id,
        fingerprint: media.inputFingerprint,
        transcriptHash: episode.transcript_hash
      }
      // Ready private components retain their saved player/cues. Only missing work adopts new inputs.
      if (media.transcript !== 'ready') {
        media.player = {
          audioUrl: episode.audio_url,
          title: episode.title,
          showName: episode.show_name,
          coverUrl: episode.cover_url,
          durationSec: episode.duration_sec,
          shownotes: episode.shownotes,
          language: podcastLanguage(episode.language)
        }
        media.transcript = 'pending'
        delete media.transcriptReason
      }
      for (const variant of Object.values(media.variants))
        if (variant.status === 'unavailable' && variant.reason === 'input_changed') {
          variant.status = 'pending'
          delete variant.reason
        }
    }
    if (!recoveringInput || media.variants[language]?.status !== 'ready') media.variants[language] = { status: 'pending' }
    if (transcript && (!episode || media.transcript !== 'ready')) {
      media.transcript = 'pending'
      delete media.transcriptReason
    }
    if (!(await this.publish(loaded, media, undefined, undefined, false, input))) throw new Error('Private request revision changed')
  }

  /** Hold the existing write state while replacing the conventional body and embedded manifest. */
  async publish(
    loaded: Pick<LoadedMediaSnapshot, 'raw'>,
    media: MediaSnapshot | null,
    body?: Body,
    bundle = new SnapshotBundle(this.bucket().R2Bucket, loaded.raw.content_key.match(/^html\/body\/([^/]+)\.html$/)?.[1] ?? loaded.raw.userBookmarks[0].uuid),
    force = false,
    input?: PodcastSnapshotInput
  ) {
    return !!(await this.writeRevision(loaded.raw, media, body, bundle, {
      mediaInput: input,
      force
    }))
  }

  private async writeRevision(
    raw: RawSnapshot,
    media: MediaSnapshot | null,
    body: Body | undefined,
    bundle: SnapshotBundle,
    options: NonNullable<Parameters<BookmarkForkRepo['publishRevision']>[3]>
  ) {
    const claimed = options.clearForkProvenance ? await this.repo.ownsWrite(raw.id, raw.updated_at) : await this.repo.claimWrite(raw.id, raw.updated_at, ['success'], options.force)
    if (!claimed) return null
    try {
      if (media && !options.force && !(await this.readable(media))) throw BookmarkNotFoundError()
      if (media) {
        media.revision = bundle.attempt
        const variant = media.bodyLanguage ? media.variants[media.bodyLanguage] : undefined
        if (!body && variant?.document) {
          const version = privateMediaVersion(media, media.bodyLanguage!)
          body =
            media.kind === 'youtube'
              ? {
                  html: HtmlBuilder.buildYoutubeArticleBody(
                    media.sourceId,
                    toCompatCues(media.cues ?? []),
                    renderMediaArticle(variant.document, version, media.cues ?? [], 'youtube')
                  ),
                  text: renderArticleText(variant.document)
                }
              : media.player
                ? {
                    html: renderPodcastBody({
                      info: media.player,
                      article: {
                        doc: variant.document,
                        version,
                        cues: (media.cues as PodcastCue[]) ?? [],
                        paragraphStarts: variant.content?.sections.map(s => s.paragraphs.map(p => p.start_ms))
                      }
                    }),
                    text: renderPodcastText({ info: media.player, doc: variant.document })
                  }
                : undefined
        }
      }
      const content = body
        ? {
            content_key: await bundle.write('body.html', body.html, 'text/html; charset=utf-8'),
            content_md_key: await bundle.write('body.txt', body.text, 'text/plain; charset=utf-8'),
            content_word_count: body.text.length
          }
        : await bundle.copyHtml(raw.content_key)
      await bundle.write('media.json', JSON.stringify(media ?? { schema: 1, kind: 'html' }), 'application/json')
      await bundle.assertUnchanged()
      const published = await this.repo.publishRevision(raw.id, raw.content_key, content, {
        ...options,
        expectedUpdatedAt: raw.updated_at,
        mediaRef: media ? this.ref(media) : undefined
      })
      if (!published && !options.clearForkProvenance) await this.repo.failWrite(raw.id, raw.updated_at)
      return published ? content : null
    } catch (error) {
      // A fixed-key write cannot be rolled back or inferred committed from its path.
      // Workflow acquisition retains its claim until its finite retries are exhausted.
      if (!options.clearForkProvenance) await this.repo.failWrite(raw.id, raw.updated_at).catch(() => {})
      throw error
    }
  }

  private async effects(ctx: ContextManager, bookmarkId: number) {
    const current = await this.repo.snapshot(bookmarkId)
    if (!current) return
    await this.bookmarks.deleteBookmarkSummary(bookmarkId, current.private_user)
    await this.repairIndex(ctx, bookmarkId)
  }

  async repairIndex(ctx: ContextManager, bookmarkId: number, managedOnly = false) {
    const current = await this.repo.snapshot(bookmarkId)
    if (!current || !current.userBookmarks.length || (managedOnly && !(await loadEmbeddedSnapshot(this.bucket().R2Bucket, current.content_key)).managed)) return false
    const revision = `${current.content_key}:${current.updated_at.toISOString()}`
    const marker = `snapshot-index:${bookmarkId}`
    if ((await ctx.env.KV.get(marker)) === revision) return true
    await this.searchRepo.upsertUserBookmark(current.private_user, bookmarkId)
    const text = current.content_md_key ? await (await this.bucket().R2Bucket.get(current.content_md_key))?.text() : ''
    if (current.content_md_key && text === undefined) throw new Error('Private text missing during indexing')
    const results = await this.search.addSearchRecord(ctx, bookmarkId, current.title, text || '')
    if (results.some(result => result.status === 'rejected')) throw new Error('Private snapshot indexing incomplete')
    const fresh = await this.repo.snapshot(bookmarkId)
    if (fresh?.content_key !== current.content_key || fresh?.updated_at.getTime() !== current.updated_at.getTime()) {
      await ctx.env.KV.delete(marker)
      if (!fresh) await Promise.all([this.searchRepo.deleteUserBookmark(current.private_user, bookmarkId), this.searchRepo.deleteBookmarkRaw(bookmarkId)])
      return true
    }
    await ctx.env.KV.put(marker, revision)
    return true
  }

  /** One acquisition's expected revision is carried by its durable workflow payload. */
  async capture(
    bookmarkId: number,
    uuid: string,
    body: Body,
    fields: NonNullable<Parameters<BookmarkForkRepo['publishRevision']>[3]>['fields'],
    media: MediaSnapshot | null,
    expectedRevision?: string
  ) {
    const raw = await this.repo.snapshot(bookmarkId)
    if (!raw || (expectedRevision && raw.updated_at.toISOString() !== expectedRevision)) throw new Error('Capture revision superseded')
    const content = await this.writeRevision(raw, media, body, new SnapshotBundle(this.bucket().R2Bucket, raw.content_key.match(/^html\/body\/([^/]+)\.html$/)?.[1] ?? uuid), {
      fields: { ...fields, status: 'success' },
      expectedUpdatedAt: raw.updated_at,
      clearForkProvenance: true
    })
    if (!content) throw new Error('Capture revision superseded')
    return content
  }
}
