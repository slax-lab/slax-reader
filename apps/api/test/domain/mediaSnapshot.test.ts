import { describe, expect, it, vi } from 'vitest'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { podcastInputFingerprint } from '@/utils/mediaSnapshot'
import { SnapshotBundle, loadEmbeddedSnapshot } from '@/utils/snapshotBundle'
import { memoryBucket } from '../utils/snapshotBucket'

describe('private media publication', () => {
  async function captureFixture(marked = false) {
    const memory = memoryBucket()
    const owners = new Map<number, number>()
    const raw: any = { id: 1, content_key: 'html/body/owner.html', status: 'success', updated_at: new Date('2026-01-01'), private_user: 7, userBookmarks: [{ uuid: 'owner' }] }
    const manifest = {
      schema: 1,
      kind: 'youtube',
      mode: 'capture',
      revision: 'old',
      sourceId: 'dQw4w9WgXcQ',
      sourceHash: 'hash',
      inputFingerprint: 'hash',
      defaultLanguage: 'en',
      transcript: 'ready',
      bodyLanguage: null,
      variants: { en: { status: 'pending' } }
    }
    const initial = new SnapshotBundle(memory.bucket, 'owner')
    await initial.write('body.html', '<article>Original transcript</article>', 'text/html')
    await initial.write('media.json', JSON.stringify(manifest), 'application/json')
    const row = { status: 'failed', target_language: 'en', error_message: 'quality', article_key: 'canonical.json', caption_key: 'captions.json' }
    await memory.bucket.put('canonical.json', JSON.stringify({ schema_version: 1, language: 'en', format: 'article', lede: 'Ready article', sections: [] }))
    await memory.bucket.put('captions.json', JSON.stringify({ cues: [] }))
    const repo = {
      snapshot: vi.fn(async () => ({ ...raw })),
      mediaDenied: vi.fn(async () => false),
      mediaRef: vi.fn(async () => ({ media_kind: 'youtube', source_id: 'dQw4w9WgXcQ', source_hash: 'hash' })),
      claimWrite: vi.fn(async (_id: number, revision: Date, statuses: string[] = ['success']) => {
        if (revision.getTime() !== raw.updated_at.getTime() || !statuses.includes(raw.status)) return false
        raw.status = 'parseing'
        return true
      }),
      ownsWrite: vi.fn(async (_id: number, revision: Date) => revision.getTime() === raw.updated_at.getTime() && raw.status === 'parseing'),
      failWrite: vi.fn(async (_id: number, revision: Date) => {
        if (revision.getTime() !== raw.updated_at.getTime() || raw.status !== 'parseing') return false
        raw.status = 'failed'
        return true
      }),
      releaseWrite: vi.fn(async (_id: number, revision: Date) => {
        if (revision.getTime() !== raw.updated_at.getTime() || raw.status !== 'parseing') return false
        raw.status = 'success'
        raw.updated_at = new Date(raw.updated_at.getTime() + 1)
        return true
      }),
      publishRevision: vi.fn(async (_id: number, expected: string, content: any, options?: any) => {
        if (raw.content_key !== expected || raw.status !== 'parseing') return false
        if (options?.expectedUpdatedAt && options.expectedUpdatedAt.getTime() !== raw.updated_at.getTime()) return false
        Object.assign(raw, content, { status: 'success', updated_at: new Date(raw.updated_at.getTime() + 1) })
        return true
      })
    }
    const settings = { enabled: true, language: 'en' }
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      repo,
      labs: { isEnabled: async () => settings.enabled },
      users: { getInfoByUserId: async () => ({ ai_lang: settings.language, lang: 'en' }) },
      bucket: () => ({ R2Bucket: memory.bucket }),
      youtube: { listForSource: vi.fn(async () => [row]) },
      marks: { bodyHasMarks: vi.fn(async () => marked) },
      vectors: {
        listContentOwners: vi.fn(async (bookmarkId: number, after: number) => {
          if (after > 0) return []
          const owner = owners.get(bookmarkId) ?? (raw.private_user > 0 ? raw.private_user : (raw.userBookmarks?.[0]?.user_id ?? 7))
          return [{ id: 1, user_id: owner }]
        }),
        findArticles: vi.fn(async (identities: { userId: number; id: number }[]) =>
          identities.map(identity => ({ user_id: identity.userId, bookmark_id: identity.id, status: 'success', updated_at: raw.updated_at }))
        )
      },
      effects: vi.fn(async () => {})
    }) as MediaSnapshotService
    return { service, repo, raw, row, memory, settings, owners }
  }

  it('preserves the fixed live body on failed publication and never deletes it', async () => {
    const fixture = await captureFixture()
    fixture.repo.publishRevision.mockResolvedValue(false)
    const deletion = vi.spyOn(fixture.memory.bucket, 'delete')
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(false)
    expect(await fixture.memory.bucket.head('html/body/owner.html')).not.toBeNull()
    expect(deletion).not.toHaveBeenCalled()
    expect(fixture.repo.failWrite).toHaveBeenCalledWith(1, fixture.raw.updated_at)
    expect(fixture.repo.releaseWrite).not.toHaveBeenCalled()
    expect(fixture.raw.status).toBe('failed')
  })

  it('republishes a failed managed capture even when the cached manifest is terminal', async () => {
    const fixture = await captureFixture()
    fixture.raw.status = 'failed'
    const bundle = new SnapshotBundle(fixture.memory.bucket, 'owner')
    const existing = String(fixture.memory.objects.get(fixture.raw.content_key)!.value)
    await bundle.write('body.html', existing, 'text/html; charset=utf-8')
    const manifest = {
      schema: 1,
      kind: 'youtube',
      mode: 'capture',
      revision: 'old',
      sourceId: 'dQw4w9WgXcQ',
      sourceHash: 'hash',
      inputFingerprint: 'hash',
      defaultLanguage: 'en',
      transcript: 'ready',
      bodyLanguage: 'en',
      variants: {
        en: {
          status: 'ready',
          document: { schema_version: 1, language: 'en', format: 'article', lede: 'Ready article', sections: [] },
          content: { language: 'en', format: 'article', lede: 'Ready article', sections: [] }
        }
      }
    }
    await bundle.write('media.json', JSON.stringify(manifest), 'application/json')
    const before = fixture.memory.objects.get(fixture.raw.content_key)!.value
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn() } } } as any, 1)).toBe(true)
    expect(fixture.repo.claimWrite).toHaveBeenCalledWith(1, expect.any(Date), ['failed'], false)
    expect(fixture.repo.publishRevision).toHaveBeenCalledOnce()
    expect(fixture.repo.failWrite).not.toHaveBeenCalled()
    expect(fixture.raw.status).toBe('success')
    expect(fixture.memory.objects.get(fixture.raw.content_key)!.value).not.toBe(before)
  })

  it('keeps a marked YouTube body while recovering a failed terminal capture', async () => {
    const fixture = await captureFixture(true)
    fixture.raw.status = 'failed'
    const bundle = new SnapshotBundle(fixture.memory.bucket, 'owner')
    const existing = String(fixture.memory.objects.get(fixture.raw.content_key)!.value)
    await bundle.write('body.html', existing, 'text/html; charset=utf-8')
    const manifest = {
      schema: 1,
      kind: 'youtube',
      mode: 'capture',
      revision: 'old',
      sourceId: 'dQw4w9WgXcQ',
      sourceHash: 'hash',
      inputFingerprint: 'hash',
      defaultLanguage: 'en',
      transcript: 'ready',
      bodyLanguage: null,
      variants: {
        en: {
          status: 'ready',
          document: { schema_version: 1, language: 'en', format: 'article', lede: 'Ready article', sections: [] },
          content: { language: 'en', format: 'article', lede: 'Ready article', sections: [] }
        }
      }
    }
    await bundle.write('media.json', JSON.stringify(manifest), 'application/json')
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn() } } } as any, 1)).toBe(true)
    expect(fixture.repo.claimWrite).toHaveBeenCalledWith(1, expect.any(Date), ['failed'], false)
    expect(fixture.memory.objects.get(fixture.raw.content_key)!.value).toContain('Original transcript')
    expect((await fixture.service.load(1))!.media!.bodyLanguage).toBeNull()
  })

  it('claims the DB request before any fixed-key writes', async () => {
    const fixture = await captureFixture()
    fixture.repo.claimWrite.mockResolvedValue(false)
    const writes = vi.spyOn(fixture.memory.bucket, 'put')
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(false)
    expect(writes).not.toHaveBeenCalled()
  })

  it("pins a first terminal failure instead of consuming another user's later retry", async () => {
    const fixture = await captureFixture()
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(true)
    const key = fixture.raw.content_key
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(false)
    expect(fixture.raw.content_key).toBe(key)
    expect((await fixture.service.load(1))?.media?.variants.en?.status).toBe('failed')
  })

  it('stores a ready supplemental article without replacing an annotated transcript', async () => {
    const fixture = await captureFixture(true)
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(true)
    const saved = (await fixture.service.load(1))!.media!
    expect(saved.bodyLanguage).toBeNull()
    expect(saved.variants.en?.content?.lede).toBe('Ready article')
    expect(await (await fixture.memory.bucket.get(fixture.raw.content_key))?.text()).toContain('Original transcript')
  })

  it.each(['disabled', 'language'])('keeps the transcript body when current YouTube promotion eligibility changes: %s', async change => {
    const fixture = await captureFixture()
    fixture.row.status = 'ready'
    if (change === 'disabled') fixture.settings.enabled = false
    else fixture.settings.language = 'zh'
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(true)
    const saved = (await fixture.service.load(1))!.media!
    expect(saved.bodyLanguage).toBeNull()
    expect(saved.variants.en?.content?.lede).toBe('Ready article')
    expect(await (await fixture.memory.bucket.get(fixture.raw.content_key))?.text()).toContain('Original transcript')
  })

  it('promotes a pending YouTube article when current settings and marks allow it', async () => {
    const fixture = await captureFixture()
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: vi.fn().mockResolvedValue({ id: 'maintenance' }) } } } as any, 1)).toBe(true)
    expect((await fixture.service.load(1))!.media!.bodyLanguage).toBe('en')
    expect(await (await fixture.memory.bucket.get(fixture.raw.content_key))?.text()).toContain('Ready article')
  })

  it.each(['ready', 'failed'])('retries admission after committed %s publication without rewriting the terminal manifest', async status => {
    const fixture = await captureFixture()
    fixture.raw.status = 'success'
    fixture.row.status = status
    const create = vi.fn().mockRejectedValueOnce(new Error('admission unavailable')).mockResolvedValue({ id: 'maintenance' })
    const ctx = { env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any
    const expected = { kind: 'youtube' as const, sourceId: 'dQw4w9WgXcQ', sourceHash: 'hash' }
    ;(fixture.service as any).effects.mockRejectedValue(new Error('legacy search unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await fixture.service.settle(ctx, 1)).toBe(true)
      expect(create).not.toHaveBeenCalled()
      await expect(fixture.service.processVectorMaintenance(ctx, 1, expected)).rejects.toMatchObject({
        message: 'Media vector maintenance admission incomplete',
        errors: [expect.objectContaining({ message: 'admission unavailable' })]
      })
      expect((await fixture.service.load(1))?.media?.variants.en?.status).toBe(status)
      expect(await fixture.service.settle(ctx, 1)).toBe(false)
      await fixture.service.processVectorMaintenance(ctx, 1, expected)
      expect(create).toHaveBeenCalledTimes(2)
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ target: { kind: 'article', userId: 7, id: 1 } }) }))
      expect(fixture.repo.publishRevision).toHaveBeenCalledOnce()
      expect(fixture.repo.claimWrite).toHaveBeenCalledOnce()
    } finally {
      log.mockRestore()
    }
  })

  it.each(['source', 'hash', 'kind', 'fork', 'policy', 'denied', 'pending', 'moderated', 'ownerless', 'missing', 'invalid'])(
    'does not admit a stale or ineligible snapshot: %s',
    async reason => {
      const fixture = await captureFixture()
      fixture.raw.status = 'success'
      const loaded = (await fixture.service.load(1))!
      if (reason === 'source') loaded.media!.sourceId = 'new-source'
      if (reason === 'hash') loaded.media!.sourceHash = 'new-hash'
      if (reason === 'kind') loaded.media!.kind = 'podcast'
      if (reason === 'fork') loaded.media!.mode = 'fork'
      if (reason === 'policy') loaded.media!.policyDenied = true
      if (reason === 'denied') fixture.repo.mediaDenied.mockResolvedValue(true)
      if (reason === 'pending') loaded.raw.status = 'pending'
      if (reason === 'moderated') loaded.raw.moderation_result = 1
      if (reason === 'ownerless') loaded.raw.userBookmarks = []
      if (reason === 'invalid') loaded.media = null
      vi.spyOn(fixture.service, 'load').mockResolvedValue(reason === 'missing' ? null : loaded)
      const create = vi.fn()
      await fixture.service.processVectorMaintenance({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any, 1, {
        kind: 'youtube',
        sourceId: 'dQw4w9WgXcQ',
        sourceHash: 'hash'
      })
      expect(create).not.toHaveBeenCalled()
    }
  )

  it.each(['youtube', 'podcast'] as const)('continues %s admission for other refs and reports the failed ref for retry', async kind => {
    const fixture = await captureFixture()
    fixture.raw.status = 'success'
    fixture.owners.set(2, 8)
    const loaded = (await fixture.service.load(1))!
    loaded.media!.kind = kind
    const listRefs = vi.fn(async () => [{ bookmark_id: 2 }, { bookmark_id: 1 }])
    ;(fixture.service as any).youtube.listRefs = listRefs
    ;(fixture.service as any).podcasts = { listEpisodeRefs: listRefs }
    vi.spyOn(fixture.service, 'load').mockImplementation(async id => ({ ...loaded, raw: { ...loaded.raw, id, private_user: id === 2 ? 8 : 7 } }))
    const create = vi.fn().mockRejectedValueOnce(new Error('admission unavailable')).mockResolvedValue({ id: 'maintenance' })
    const ctx = { env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any
    await expect(fixture.service.processSourceVectorMaintenance(ctx, kind, 'dQw4w9WgXcQ', 'hash')).rejects.toThrow('Media vector maintenance admission incomplete')
    expect(create).toHaveBeenCalledTimes(2)
    await fixture.service.processSourceVectorMaintenance(ctx, kind, 'dQw4w9WgXcQ', 'hash')
    expect(create).toHaveBeenCalledTimes(4)
    expect(fixture.repo.publishRevision).not.toHaveBeenCalled()
  })

  it.each(['matching', 'stale', 'denied'])('checks legacy media reference before admission: %s', async state => {
    const fixture = await captureFixture()
    fixture.raw.status = 'success'
    fixture.raw.private_user = 0
    fixture.raw.userBookmarks[0].user_id = 9
    const ref = { media_kind: 'youtube', source_id: 'dQw4w9WgXcQ', source_hash: state === 'stale' ? 'new-hash' : 'hash' }
    ;(fixture.repo as any).mediaRef = vi.fn(async () => ref)
    fixture.repo.mediaDenied.mockResolvedValue(state === 'denied')
    vi.spyOn(fixture.service, 'load').mockResolvedValue({ raw: fixture.raw, media: null, managed: false })
    const create = vi.fn().mockResolvedValue({ id: 'maintenance' })
    await fixture.service.processVectorMaintenance({ env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any, 1, {
      kind: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
      sourceHash: 'hash'
    })
    expect(create).toHaveBeenCalledTimes(state === 'matching' ? 1 : 0)
    if (state === 'matching') expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ target: { kind: 'article', userId: 9, id: 1 } }) }))
  })

  it('pins the inputs returned by this acquisition rather than another save during initialization', async () => {
    const captured: any = { audio_url: 'audio', title: 'A', show_name: 'Show A', shownotes: 'Notes A', duration_sec: 10, publisher_transcripts: [], language: 'en' }
    const later = { ...captured, title: 'B', shownotes: 'Notes B' }
    const episodes = { findBySourceId: vi.fn(async () => later) }
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      episodes,
      language: async () => 'en',
      labs: { isEnabled: async () => true }
    }) as MediaSnapshotService
    const media = await service.initialize({ media_kind: 'podcast', source_id: 'episode', source_hash: '' }, 1, undefined, captured)
    expect(media.inputFingerprint).toBe(await podcastInputFingerprint(captured))
    expect(media.inputFingerprint).not.toBe(await podcastInputFingerprint(later))
    expect(media.player?.title).toBe('A')
    expect(episodes.findBySourceId).not.toHaveBeenCalled()
  })

  it('copies a frozen manifest without subscribing to pending source variants', async () => {
    const { bucket } = memoryBucket()
    const key = 'html/body/source.html'
    const source = new SnapshotBundle(bucket, 'source')
    await source.write('body.html', '<article>Source transcript</article>', 'text/html')
    await source.write(
      'media.json',
      JSON.stringify({
        schema: 1,
        kind: 'youtube',
        mode: 'capture',
        revision: 'first',
        sourceId: 'video',
        sourceHash: 'hash',
        inputFingerprint: 'hash',
        defaultLanguage: 'en',
        transcript: 'ready',
        bodyLanguage: null,
        variants: { en: { status: 'pending' } }
      }),
      'application/json'
    )
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      bucket: () => ({ R2Bucket: bucket }),
      repo: { mediaDenied: vi.fn(async () => false) }
    }) as MediaSnapshotService
    const bundle = new SnapshotBundle(bucket, 'destination')
    await bundle.copyHtml(key)
    const result = await service.copyForFork({ id: 1, content_key: key, private_user: 1 } as any, bundle)
    expect(result).toEqual({ ref: { media_kind: 'youtube', source_id: 'video', source_hash: 'hash' }, input: undefined })
    await bucket.delete([key, key.replace('body.html', 'media.json')])
    const own = (await loadEmbeddedSnapshot(bucket, 'html/body/destination.html')).manifest as any
    expect(own.mode).toBe('fork')
    expect(own.variants.en.status).toBe('unavailable')
    expect(own.bodyLanguage).toBeNull()
  })

  it('leaves a failed acquisition attempt owned so its finite Workflow retry can succeed', async () => {
    const fixture = await captureFixture()
    fixture.raw.status = 'parseing'
    let owns = true
    fixture.repo.ownsWrite.mockImplementation(async () => owns)
    fixture.repo.failWrite.mockImplementation(async () => {
      owns = false
      return true
    })
    const put = vi.spyOn(fixture.memory.bucket, 'put')
    put.mockRejectedValueOnce(new Error('temporary R2 failure'))
    const args = [1, 'owner', { html: '<article>Captured</article>', text: 'Captured' }, {}, null, fixture.raw.updated_at.toISOString()] as const
    await expect(fixture.service.capture(...args)).rejects.toThrow('temporary R2 failure')
    expect(fixture.repo.failWrite).not.toHaveBeenCalled()
    await expect(fixture.service.capture(...args)).resolves.toMatchObject({ content_key: 'html/body/owner.html' })
    expect(fixture.repo.ownsWrite).toHaveBeenCalledTimes(2)
  })

  it('continues settling other refs after one invalid private manifest', async () => {
    const fixture = await captureFixture()
    ;(fixture.service as any).youtube.listRefs = async () => [{ bookmark_id: 2 }, { bookmark_id: 1 }]
    const load = fixture.service.load.bind(fixture.service)
    vi.spyOn(fixture.service, 'load').mockImplementation(async id => {
      if (id === 2) throw new Error('invalid manifest')
      return load(id)
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fixture.service.settleSource({} as any, 'youtube', 'video')).rejects.toThrow('Private media publication incomplete')
    expect(fixture.repo.publishRevision).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})
