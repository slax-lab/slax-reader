import { describe, expect, it, vi } from 'vitest'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { YoutubeArticleService } from '@/domain/youtubeArticle'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { PodcastService } from '@/domain/podcast'
import { podcastInputFingerprint, freezeMediaSnapshot } from '@/utils/mediaSnapshot'
import { PodcastEpisodeRepo } from '@/infra/repository/dbPodcastArticle'
import recoveryResponses from '../fixtures/podcast/recovery-status.json'
import { memoryBucket } from '../utils/snapshotBucket'

const embeddedBody = (manifest: unknown) => `<article>Original saved body A</article><script id="slax-private-snapshot" type="application/json">${JSON.stringify(manifest)}</script>`

async function fixture(kind: 'youtube' | 'podcast') {
  const memory = memoryBucket()
  const raw: any = {
    id: 1,
    content_key: 'html/body/owner.html',
    status: 'success',
    updated_at: new Date('2026-10-22T00:00:00Z'),
    private_user: 7,
    userBookmarks: [{ uuid: 'owner' }]
  }
  const ep: any = {
    id: 2,
    source_id: 'source',
    audio_url: 'https://example.com/a.mp3',
    title: 'A',
    show_name: 'Show',
    shownotes: 'Notes',
    duration_sec: 60,
    publisher_transcripts: [],
    language: 'en',
    transcript_status: 'pending',
    transcript_hash: null,
    transcript_key: null
  }
  const manifest: any = {
    schema: 1,
    kind,
    mode: 'capture',
    revision: 'old',
    sourceId: 'source',
    sourceHash: kind === 'youtube' ? 'hash' : '',
    inputFingerprint: kind === 'youtube' ? 'hash' : await podcastInputFingerprint(ep),
    defaultLanguage: 'en',
    transcript: kind === 'youtube' ? 'ready' : 'pending',
    bodyLanguage: null,
    variants: { en: { status: 'pending' } },
    ...(kind === 'podcast'
      ? {
          player: {
            audioUrl: ep.audio_url,
            title: ep.title,
            showName: ep.show_name,
            shownotes: ep.shownotes,
            durationSec: 60,
            language: 'en'
          }
        }
      : {})
  }
  await memory.bucket.put(raw.content_key, embeddedBody(manifest), { customMetadata: { snapshot_owner: 'owner' } })
  await memory.bucket.put(
    'article.json',
    JSON.stringify({
      schema_version: 1,
      language: 'en',
      format: 'article',
      lede: 'New article B',
      sections: []
    })
  )
  await memory.bucket.put('transcript.json', JSON.stringify({ language: 'en', cues: [] }))
  const rows: any[] = [
    {
      id: 3,
      status: 'ready',
      target_language: 'en',
      article_key: 'article.json'
    }
  ]
  const articles: any = {
    listForSource: async () => rows,
    listRefs: async () => [{ bookmark_id: 1 }],
    listEpisodeRefs: async () => [{ bookmark_id: 1 }],
    findRef: async () => ({ source_id: 'source' }),
    findVersion: async () => rows[0],
    requeue: vi.fn(async () => false)
  }
  const episodes: any = {
    findBySourceId: async () => ep,
    findById: async () => ep
  }
  const repo: any = {
    snapshot: async () => ({ ...raw }),
    mediaDenied: async () => false,
    claimWrite: vi.fn(async (id: number, revision: Date, statuses: string[] = ['success']) => {
      if (id !== raw.id || revision.getTime() !== raw.updated_at.getTime() || !statuses.includes(raw.status)) return false
      raw.status = 'parseing'
      return true
    }),
    ownsWrite: vi.fn(async (id: number, revision: Date) => id === raw.id && revision.getTime() === raw.updated_at.getTime() && raw.status === 'parseing'),
    releaseWrite: vi.fn(async (id: number, revision: Date) => {
      if (id !== raw.id || revision.getTime() !== raw.updated_at.getTime() || raw.status !== 'parseing') return false
      raw.status = 'success'
      raw.updated_at = new Date(raw.updated_at.getTime() + 1)
      return true
    }),
    failWrite: vi.fn(async (id: number, revision: Date) => {
      if (id !== raw.id || revision.getTime() !== raw.updated_at.getTime() || raw.status !== 'parseing') return false
      raw.status = 'failed'
      return true
    }),
    publishRevision: vi.fn(async (_id: number, expected: string, content: any, options: any) => {
      if (raw.content_key !== expected || raw.status !== 'parseing' || options.expectedUpdatedAt.getTime() !== raw.updated_at.getTime()) return false
      Object.assign(raw, content, { status: 'success', updated_at: new Date(raw.updated_at.getTime() + 1) })
      return true
    })
  }
  const snapshots = Object.assign(Object.create(MediaSnapshotService.prototype), {
    repo,
    bucket: () => ({ R2Bucket: memory.bucket }),
    youtube: articles,
    labs: { isEnabled: async () => true },
    users: { getInfoByUserId: async () => ({ lang: 'en' }) },
    podcasts: articles,
    episodes,
    marks: { bodyHasMarks: async () => false },
    bookmarks: { deleteBookmarkSummary: async () => {} },
    searchRepo: { upsertUserBookmark: async () => {} },
    search: { addSearchRecord: async () => [] }
  }) as MediaSnapshotService
  const access = {
    getBookmarkReadAccess: async () => ({
      bookmark: {
        user_id: 7,
        bookmark_id: 1,
        bookmark: { moderation_result: 0 }
      }
    })
  }
  const service: PodcastService | YoutubeArticleService = Object.assign(Object.create(kind === 'podcast' ? PodcastService.prototype : YoutubeArticleService.prototype), {
    snapshots,
    repo: articles,
    articles,
    episodes,
    bookmarkService: access,
    labService: { isEnabled: async () => true },
    userRepo: { getInfoByUserId: async () => ({ lang: 'en' }) }
  })
  const ctx: any = {
    getUserId: () => 7,
    env: {
      KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {}
      }
    }
  }
  return { memory, raw, ep, manifest, snapshots, service, ctx, repo, articles }
}

describe('managed media owner recovery', () => {
  it('does not overwrite fixed keys when another revision owns publication', async () => {
    const f = await fixture('youtube')
    f.raw.status = 'parseing'
    const before = f.memory.objects.get(f.raw.content_key)!.value
    expect(await f.snapshots.settle(f.ctx, 1)).toBe(false)
    expect(f.memory.objects.get(f.raw.content_key)!.value).toBe(before)
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
    expect(f.repo.failWrite).not.toHaveBeenCalled()
  })

  it.each(['youtube', 'podcast'] as const)('%s status retains its private state when publication fails transiently', async kind => {
    const f = await fixture(kind)
    if (kind === 'podcast')
      Object.assign(f.ep, {
        transcript_status: 'ready',
        transcript_hash: 'hash',
        transcript_key: 'transcript.json'
      })
    f.repo.publishRevision.mockRejectedValue(new Error('DB unavailable'))
    const status = await f.service.getStatus(f.ctx, 'owner')
    expect(kind === 'youtube' ? (status as any).status : (status as any).article).toBe('pending')
    expect(f.raw.content_key).toBe('html/body/owner.html')
    expect(f.repo.publishRevision).toHaveBeenCalled()
    expect(f.repo.releaseWrite).toHaveBeenCalledWith(1, expect.any(Date))
    expect(f.raw.status).toBe('success')
  })

  it.each(['youtube', 'podcast'] as const)('%s retries a failed R2 write through the original publication trigger', async kind => {
    const f = await fixture(kind)
    if (kind === 'podcast') Object.assign(f.ep, { transcript_status: 'ready', transcript_hash: 'hash', transcript_key: 'transcript.json' })
    const initialRevision = new Date(f.raw.updated_at)
    vi.spyOn(f.memory.bucket, 'put').mockRejectedValueOnce(new Error('transient R2 failure'))
    await expect(f.snapshots.settleSource(f.ctx, kind, 'source')).rejects.toThrow('Private media publication incomplete')
    expect(f.raw.status).toBe('success')
    expect((await f.snapshots.load(1))?.media?.variants.en?.status).toBe('pending')
    expect(await f.snapshots.settleSource(f.ctx, kind, 'source')).toBe(1)
    expect((await f.snapshots.load(1))?.media?.variants.en?.status).toBe('ready')
    expect(f.raw.updated_at.getTime()).toBeGreaterThan(initialRevision.getTime())
    expect(await f.snapshots.settleSource(f.ctx, kind, 'source')).toBe(0)
  })

  it('cannot release or write a newer owner acquisition after supplemental failure', async () => {
    const f = await fixture('youtube')
    vi.spyOn(f.memory.bucket, 'put').mockImplementationOnce(async () => {
      f.raw.updated_at = new Date(f.raw.updated_at.getTime() + 100)
      throw new Error('stale publication')
    })
    await expect(f.snapshots.settleSource(f.ctx, 'youtube', 'source')).rejects.toThrow()
    expect(f.raw.status).toBe('parseing')
    expect(await f.snapshots.settleSource(f.ctx, 'youtube', 'source')).toBe(0)
  })

  it.each(['youtube', 'podcast'] as const)('%s fails closed on a missing manifest and on denied policy', async kind => {
    const f = await fixture(kind)
    await f.memory.bucket.put(f.raw.content_key, '<article>Missing manifest</article>', { customMetadata: { snapshot_owner: 'owner' } })
    await expect(f.service.getStatus(f.ctx, 'owner')).rejects.toThrow()
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    f.repo.mediaDenied = async () => true
    const status = await f.service.getStatus(f.ctx, 'owner')
    expect(kind === 'youtube' ? (status as any).status : (status as any).article).toBe('unavailable')
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
  })

  it('indexes the stored managed capture immediately without periodic deduplication markers', async () => {
    const f = await fixture('youtube')
    f.raw.title = 'Stored title'
    f.raw.content_md_key = 'text/body/owner.txt'
    await f.memory.bucket.put(f.raw.content_md_key, 'Stored text')
    const indexed: string[] = []
    const markers = new Map<string, string>()
    f.ctx.env.KV = {
      get: async (key: string) => markers.get(key),
      put: async (key: string, value: string) => markers.set(key, value),
      delete: async (key: string) => markers.delete(key)
    }
    Object.assign(f.snapshots, {
      search: {
        addSearchRecord: async (_ctx: unknown, _id: number, title: string, text: string) => {
          indexed.push(`${title}:${text}`)
          return []
        }
      }
    })
    let background: Promise<unknown> | undefined
    f.ctx.execution = {
      waitUntil: (work: Promise<unknown>) => {
        background = work
      }
    }
    const legacy: string[] = []
    const handler = Object.assign(Object.create(UrlParserHandler.prototype), {
      snapshots: f.snapshots,
      searchSvc: {
        addSearchRecord: async () => {
          legacy.push('legacy')
          return []
        }
      },
      logsService: { track: async () => {} },
      bookmarkSvc: { updateUserBookmarkCreateAt: async () => {} }
    }) as UrlParserHandler
    await handler.processPostHandler(
      f.ctx,
      {
        info: {
          userId: 7,
          bookmarkId: 1,
          callback: 0,
          ignoreGenerateTag: true,
          targetUrl: 'https://example.com',
          targetTitle: 'Title'
        }
      } as any,
      { title: 'Stale parse title', textContent: 'Stale parse text' }
    )
    await background
    await f.snapshots.indexSnapshot(f.ctx, 1)
    expect(indexed).toEqual(['Stored title:Stored text', 'Stored title:Stored text'])
    expect(legacy).toEqual([])
    expect(markers.size).toBe(0)
  })

  it('allows only explicit owner retry to adopt changed podcast inputs and consume the ready result', async () => {
    const f = await fixture('podcast')
    const frozen = freezeMediaSnapshot(f.manifest, 'frozen')
    await f.memory.bucket.put('html/body/fork.html', embeddedBody(frozen))
    const frozenBefore = f.memory.objects.get('html/body/fork.html')!.value
    Object.assign(f.ep, {
      title: 'B',
      transcript_status: 'ready',
      transcript_hash: 'hash-b',
      transcript_key: 'transcript.json'
    })
    const unavailable = await f.service.getStatus(f.ctx, 'owner')
    expect(unavailable).toMatchObject({
      transcript: 'failed',
      article: 'failed',
      can_retry: true
    })
    const stopped = (await f.snapshots.load(1))!.media!
    expect(stopped.inputFingerprint).toBe(f.manifest.inputFingerprint)
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('Original saved body A')
    const ready = await (f.service as PodcastService).retry(f.ctx, 'owner')
    expect(ready).toMatchObject({
      transcript: 'ready',
      article: 'ready',
      body_ready: true,
      can_retry: false
    })
    const recovered = (await f.snapshots.load(1))!.media!
    expect(recovered.inputFingerprint).toBe(await podcastInputFingerprint(f.ep))
    expect(recovered.sourceHash).toBe('hash-b')
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('New article B')
    expect(f.memory.objects.get('html/body/fork.html')!.value).toBe(frozenBefore)
    expect(f.articles.requeue).not.toHaveBeenCalled()
    expect(f.repo.publishRevision.mock.calls.some((call: any[]) => call[3]?.mediaInput?.fingerprint === recovered.inputFingerprint)).toBe(true)
  })
  it('keeps a ready podcast original and its cue mapping while recovering only the missing translation', async () => {
    const f = await fixture('podcast')
    const originalDoc: any = {
      schema_version: 1,
      language: 'en',
      format: 'article',
      lede: 'Saved original A',
      sections: []
    }
    const original: any = {
      status: 'ready',
      document: originalDoc,
      content: {
        language: 'en',
        format: 'article',
        lede: 'Saved original A',
        sections: []
      }
    }
    Object.assign(f.manifest, {
      transcript: 'ready',
      sourceHash: 'old-hash',
      bodyLanguage: 'en',
      cues: [{ id: 'c1', start_ms: 100, end_ms: 200, text: 'Old cue' }],
      variants: { en: original, zh: { status: 'pending' } }
    })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    Object.assign(f.service, {
      userRepo: { getInfoByUserId: async () => ({ lang: 'zh' }) }
    })
    Object.assign(f.ep, {
      title: 'B',
      transcript_status: 'ready',
      transcript_hash: 'new-hash',
      transcript_key: 'transcript.json'
    })
    await f.memory.bucket.put(
      'transcript.json',
      JSON.stringify({
        language: 'en',
        cues: [{ id: 'c1', start_ms: 900, end_ms: 1000, text: 'New cue' }]
      })
    )
    const translated = {
      schema_version: 1,
      language: 'zh',
      format: 'article',
      lede: 'Translation B',
      sections: [
        {
          heading: 'Section',
          start_ms: 0,
          end_ms: 1000,
          paragraphs: [{ speaker: null, text: 'Translated', source_cue_ids: ['c1'] }]
        }
      ]
    }
    await f.memory.bucket.put('translated.json', JSON.stringify(translated))
    f.articles.listForSource = async () => [
      {
        id: 4,
        target_language: 'zh',
        status: 'ready',
        article_key: 'translated.json'
      }
    ]
    expect(await f.service.getStatus(f.ctx, 'owner')).toMatchObject({
      transcript: 'ready',
      article: 'ready',
      can_retry: true,
      translation: { status: 'failed' }
    })
    await (f.service as PodcastService).retry(f.ctx, 'owner')
    const recovered = (await f.snapshots.load(1))!.media!
    expect(recovered.variants.en).toEqual(original)
    expect(recovered.player).toEqual(f.manifest.player)
    expect(recovered.cues).toEqual(f.manifest.cues)
    expect(recovered.variants.zh?.content?.sections[0].paragraphs[0].start_ms).toBe(900)
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('Saved original A')
  })

  it('never marks a newer revision at the same fixed key as indexed by an earlier in-flight embedding', async () => {
    const f = await fixture('youtube')
    const markers = new Map<string, string>()
    f.ctx.env.KV = {
      get: async (key: string) => markers.get(key),
      put: async (key: string, value: string) => markers.set(key, value),
      delete: async (key: string) => markers.delete(key)
    }
    Object.assign(f.snapshots, {
      search: {
        addSearchRecord: async () => {
          f.raw.updated_at = new Date(f.raw.updated_at.getTime() + 1)
          return []
        }
      }
    })
    await f.snapshots.indexSnapshot(f.ctx, 1)
    expect(markers.has('snapshot-index:1')).toBe(false)
  })

  it.each(['pending', 'transcribing'])('reattaches changed inputs to an already %s episode without another generation', async transcript_status => {
    const f = await fixture('podcast')
    Object.assign(f.ep, {
      title: 'B',
      transcript_status,
      next_retry_at: new Date()
    })
    expect(await f.service.getStatus(f.ctx, 'owner')).toMatchObject({
      can_retry: true
    })
    const status = await (f.service as PodcastService).retry(f.ctx, 'owner')
    expect(status).toMatchObject({ transcript: 'pending', can_retry: false })
    expect((await f.snapshots.load(1))!.media!.inputFingerprint).toBe(await podcastInputFingerprint(f.ep))
  })
  it('renders a newly recovered article with its own resolved times while retaining the successful saved transcript cues', async () => {
    const f = await fixture('podcast')
    const oldCues = [{ id: 'c1', start_ms: 100, end_ms: 200, text: 'Saved transcript' }]
    Object.assign(f.manifest, { transcript: 'ready', sourceHash: 'old-hash', cues: oldCues })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    Object.assign(f.ep, { title: 'B', transcript_status: 'ready', transcript_hash: 'new-hash', transcript_key: 'transcript.json' })
    await f.memory.bucket.put('transcript.json', JSON.stringify({ language: 'en', cues: [{ id: 'c1', start_ms: 900, end_ms: 1000, text: 'New transcript' }] }))
    await f.memory.bucket.put(
      'article.json',
      JSON.stringify({
        schema_version: 1,
        language: 'en',
        format: 'article',
        lede: 'Recovered original',
        sections: [{ heading: 'Section', start_ms: 0, end_ms: 1000, paragraphs: [{ speaker: null, text: 'Recovered paragraph', source_cue_ids: ['c1'] }] }]
      })
    )
    expect(await f.service.getStatus(f.ctx, 'owner')).toMatchObject({ can_retry: true })
    await (f.service as PodcastService).retry(f.ctx, 'owner')
    expect((await f.snapshots.load(1))!.media!.cues).toEqual(oldCues)
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('data-start-ms="900"')
  })

  it.each(['deferred', 'transcribing', 'new-pending'])('preserves a ready English variant when its owner switches back to English during %s input recovery', async phase => {
    const f = await fixture('podcast')
    const original = {
      status: 'ready',
      document: { schema_version: 1, language: 'en', format: 'article', lede: 'Saved English original', sections: [] },
      content: { language: 'en', format: 'article', lede: 'Saved English original', sections: [] }
    }
    Object.assign(f.manifest, {
      transcript: 'ready',
      sourceHash: 'old-hash',
      bodyLanguage: 'en',
      cues: [{ id: 'old', start_ms: 100, duration_ms: 200, text: 'Saved cue' }],
      variants: { en: original, zh: { status: 'unavailable', reason: 'input_changed' } }
    })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    Object.assign(f.ep, { title: 'B', transcript_status: phase === 'transcribing' ? 'transcribing' : 'pending', next_retry_at: phase === 'deferred' ? new Date() : null })
    const counter = { get: async () => 0, incrWithExpire: async () => 1, incrBy: async () => 0 }
    Object.assign(f.service, { redis: () => ({ podcastDaily: () => counter, podcastCost: () => counter, podcastStartLock: () => ({ setIfAbsent: async () => true }) }) })
    Object.assign((f.service as any).episodes, {
      countRunning: async () => 0,
      defer: async (_id: number, at: Date) => {
        f.ep.next_retry_at = at
        return true
      }
    })
    f.articles.countRunning = async () => 0
    const starts: unknown[] = []
    f.ctx.env.PODCAST_WORKFLOW = {
      create: async (request: unknown) => {
        starts.push(request)
      }
    }
    await (f.service as PodcastService).retry(f.ctx, 'owner')
    const recovered = (await f.snapshots.load(1))!.media!
    expect(recovered.variants.en).toEqual(original)
    expect(recovered.variants.zh).toEqual({ status: 'pending' })
    expect(recovered.transcript).toBe('ready')
    expect(recovered.player).toEqual(f.manifest.player)
    expect(recovered.cues).toEqual(f.manifest.cues)
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('Saved English original')
    expect(starts).toHaveLength(phase === 'new-pending' ? 1 : 0)
  })

  it('keeps ready podcast content when an input-recovery request names the now-preferred ready language', async () => {
    const f = await fixture('podcast')
    const original = {
      status: 'ready',
      document: { schema_version: 1, language: 'en', format: 'article', lede: 'Saved original', sections: [] },
      content: { language: 'en', format: 'article', lede: 'Saved original', sections: [] }
    }
    Object.assign(f.manifest, { transcript: 'ready', bodyLanguage: 'en', variants: { en: original, zh: { status: 'unavailable', reason: 'input_changed' } } })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    f.ep.title = 'B'
    await f.snapshots.openRequest(1, 'en', true, f.ep)
    const recovered = (await f.snapshots.load(1))!.media!
    expect(recovered.variants.en).toEqual(original)
    expect(recovered.variants.zh).toEqual({ status: 'pending' })
  })

  it.each(['youtube', 'podcast'] as const)('retains the ordinary explicit %s refresh behavior outside input recovery', async kind => {
    const f = await fixture(kind)
    const original = {
      status: 'ready',
      document: { schema_version: 1, language: 'en', format: 'article', lede: 'Original', sections: [] },
      content: { language: 'en', format: 'article', lede: 'Original', sections: [] }
    }
    Object.assign(f.manifest, { transcript: 'ready', variants: { en: original } })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    await f.snapshots.openRequest(1, 'en', false, kind === 'podcast' ? f.ep : undefined)
    expect((await f.snapshots.load(1))!.media!.variants.en).toEqual({ status: 'pending' })
  })
  it.each(['missing', 'pending'])('starts only the previously requested Chinese work when its canonical article is %s and the owner now prefers English', async articleState => {
    const f = await fixture('podcast')
    const original = {
      status: 'ready',
      document: { schema_version: 1, language: 'en', format: 'article', lede: 'Saved English original', sections: [] },
      content: { language: 'en', format: 'article', lede: 'Saved English original', sections: [] }
    }
    Object.assign(f.manifest, {
      transcript: 'ready',
      sourceHash: 'old-hash',
      bodyLanguage: 'en',
      variants: { en: original, zh: { status: 'unavailable', reason: 'input_changed' } }
    })
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
    Object.assign(f.ep, { title: 'B', transcript_status: 'ready', transcript_hash: 'new-hash', transcript_key: 'transcript.json' })
    const rows: any[] = [{ id: 3, target_language: 'en', status: 'ready', article_key: 'article.json' }]
    if (articleState === 'pending') rows.push({ id: 4, target_language: 'zh', status: 'pending', article_key: null, eligibility_json: { decision: 'generate', reason_codes: [] } })
    const createdLanguages: string[] = []
    f.articles.listForSource = async () => rows
    f.articles.findVersion = async (_source: string, _hash: string, language: string) => rows.find(row => row.target_language === language) ?? null
    f.articles.recordEvaluation = async (input: any) => {
      createdLanguages.push(input.target_language)
      const row = { id: 4, ...input }
      rows.push(row)
      return row
    }
    f.articles.countRunning = async () => 0
    Object.assign((f.service as any).episodes, { countRunning: async () => 0 })
    Object.assign(f.service, { redis: () => ({ podcastCost: () => ({ get: async () => 0 }), podcastStartLock: () => ({ setIfAbsent: async () => true }) }) })
    const starts: unknown[] = []
    f.ctx.env.PODCAST_WORKFLOW = {
      create: async (request: unknown) => {
        starts.push(request)
      }
    }
    await (f.service as PodcastService).retry(f.ctx, 'owner')
    const recovered = (await f.snapshots.load(1))!.media!
    expect(recovered.variants.en).toEqual(original)
    expect(recovered.variants.zh).toMatchObject({ status: 'pending' })
    expect(rows.find(row => row.target_language === 'en').status).toBe('ready')
    expect(rows.filter(row => row.status === 'pending').map(row => row.target_language)).toEqual(['zh'])
    expect(createdLanguages).toEqual(articleState === 'missing' ? ['zh'] : [])
    expect(starts).toHaveLength(1)
  })
  it.each(['transcript', 'article', 'translation'] as const)(
    'projects owner input-changed %s recovery into the shipped retry contract without changing stored state',
    async stage => {
      const f = await fixture('podcast')
      const ready = { status: 'ready', content: { language: 'en', format: 'article', lede: 'Saved', sections: [] } }
      f.manifest.transcript = stage === 'transcript' ? 'unavailable' : 'ready'
      f.manifest.transcriptReason = stage === 'transcript' ? 'input_changed' : undefined
      f.manifest.bodyLanguage = stage === 'translation' ? 'en' : null
      f.manifest.variants =
        stage === 'translation' ? { en: ready, zh: { status: 'unavailable', reason: 'input_changed' } } : { en: { status: 'unavailable', reason: 'input_changed' } }
      if (stage === 'translation') Object.assign(f.service, { userRepo: { getInfoByUserId: async () => ({ lang: 'zh' }) } })
      await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
      expect(await f.service.getStatus(f.ctx, 'owner')).toEqual(recoveryResponses[stage])
      const stored = (await f.snapshots.load(1))!.media!
      expect(stage === 'transcript' ? stored.transcript : stored.variants[stage === 'translation' ? 'zh' : 'en']?.status).toBe('unavailable')
    }
  )

  it.each(['visitor', 'fork', 'disabled', 'permanent'])('does not offer input-change recovery for %s states', async excluded => {
    for (const stage of ['transcript', 'article', 'translation'] as const) {
      const f = await fixture('podcast')
      const reason = excluded === 'permanent' ? undefined : 'input_changed'
      f.manifest.transcript = stage === 'transcript' ? 'unavailable' : 'ready'
      f.manifest.transcriptReason = stage === 'transcript' ? reason : undefined
      f.manifest.bodyLanguage = stage === 'translation' ? 'en' : null
      f.manifest.variants =
        stage === 'translation'
          ? { en: { status: 'ready', content: { language: 'en', format: 'article', lede: 'Saved', sections: [] } }, zh: { status: 'unavailable', reason } }
          : { en: { status: 'unavailable', reason } }
      if (excluded === 'fork') f.manifest.mode = 'fork'
      if (excluded === 'disabled') Object.assign(f.service, { labService: { isEnabled: async () => false } })
      if (excluded === 'visitor') f.ctx.getUserId = () => 8
      if (stage === 'translation') Object.assign(f.service, { userRepo: { getInfoByUserId: async () => ({ lang: 'zh' }) } })
      await f.memory.bucket.put(f.raw.content_key, embeddedBody(f.manifest))
      const status: any = await f.service.getStatus(f.ctx, 'owner')
      expect(status.can_retry).toBe(false)
      expect(stage === 'transcript' ? status.transcript : stage === 'translation' ? status.translation.status : status.article).toBe('unavailable')
    }
  })

  it.each([null, 60])('settles normal transcription completion when duration changes from %s to the measured value', async initialDuration => {
    const f = await fixture('podcast')
    f.ep.duration_sec = initialDuration
    Object.assign(f.snapshots, { users: { getInfoByUserId: async () => ({ lang: 'en' }) }, labs: { isEnabled: async () => true } })
    const media = await f.snapshots.initialize({ media_kind: 'podcast', source_id: f.ep.source_id, source_hash: '' }, 7, undefined, f.ep)
    await f.memory.bucket.put(f.raw.content_key, embeddedBody(media))
    Object.assign(f.ep, { transcript_status: 'transcribing', run_id: 'run' })
    const episodes = new PodcastEpisodeRepo((() => ({
      sr_podcast_episode: {
        updateMany: async ({ where, data }: any) => {
          if (f.ep.id !== where.id || f.ep.run_id !== where.run_id || f.ep.transcript_status !== where.transcript_status) return { count: 0 }
          Object.assign(f.ep, data)
          return { count: 1 }
        },
        findUnique: async () => f.ep
      }
    })) as any)
    Object.assign(f.snapshots, { episodes })
    expect(
      await episodes.markReady(f.ep.id, 'run', { source: 'assemblyai', key: 'transcript.json', hash: 'measured-hash', speakers: false, language: 'en', durationSec: 180 })
    ).toBe(true)
    expect(await f.snapshots.settle(f.ctx, 1)).toBe(true)
    const saved = (await f.snapshots.load(1))!.media!
    expect(saved.transcript).toBe('ready')
    expect(saved.variants.en?.status).toBe('ready')
    expect(saved.sourceHash).toBe('measured-hash')
    expect(saved.inputFingerprint).toBe(media.inputFingerprint)
    expect(f.repo.publishRevision.mock.calls.at(-1)?.[3].mediaInput).toEqual({ sourceId: f.ep.source_id, fingerprint: media.inputFingerprint, transcriptHash: 'measured-hash' })
  })

  it.each(['title', 'audio_url', 'publisher_transcripts'])('rejects genuine changed podcast input %s while settling a pending request', async field => {
    const f = await fixture('podcast')
    Object.assign(f.ep, {
      transcript_status: 'ready',
      transcript_hash: 'hash',
      transcript_key: 'transcript.json',
      [field]: field === 'publisher_transcripts' ? [{ url: 'https://new.example/transcript.vtt' }] : 'Changed input'
    })
    expect(await f.snapshots.settle(f.ctx, 1)).toBe(true)
    const saved = (await f.snapshots.load(1))!.media!
    expect(saved.transcript).toBe('unavailable')
    expect(saved.transcriptReason).toBe('input_changed')
    expect(saved.inputFingerprint).toBe(f.manifest.inputFingerprint)
  })

  it.each(['disabled', 'language'])('keeps a newly saved YouTube supplement readable when promotion is blocked by current %s settings', async change => {
    const f = await fixture('youtube')
    Object.assign(f.snapshots, {
      labs: { isEnabled: async () => change !== 'disabled' },
      users: { getInfoByUserId: async () => ({ ai_lang: change === 'language' ? 'zh' : 'en', lang: 'en' }) }
    })
    if (change === 'disabled') Object.assign(f.service, { labService: { isEnabled: async () => false } })
    expect(await f.snapshots.settle(f.ctx, 1)).toBe(true)
    const saved = (await f.snapshots.load(1))!.media!
    expect(saved.bodyLanguage).toBeNull()
    expect(await (await f.memory.bucket.get(f.raw.content_key))!.text()).toContain('Original saved body A')
    expect(await (f.service as YoutubeArticleService).getContent(f.ctx, 'owner', `${saved.revision}-en`)).toMatchObject({ language: 'en', lede: 'New article B' })
  })
})
