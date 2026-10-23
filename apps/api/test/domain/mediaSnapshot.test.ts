import { describe, expect, it, vi } from 'vitest'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { podcastInputFingerprint } from '@/utils/mediaSnapshot'
import { SnapshotBundle, loadEmbeddedSnapshot } from '@/utils/snapshotBundle'
import { memoryBucket } from '../utils/snapshotBucket'

describe('private media publication', () => {
  async function captureFixture(marked = false) {
    const memory = memoryBucket()
    const raw: any = { id: 1, content_key: 'html/body/owner.html', updated_at: new Date('2026-01-01'), private_user: 7, userBookmarks: [{ uuid: 'owner' }] }
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
      snapshot: vi.fn(async () => raw),
      mediaDenied: vi.fn(async () => false),
      claimWrite: vi.fn(async () => true),
      ownsWrite: vi.fn(async () => true),
      failWrite: vi.fn(async () => true),
      releaseWrite: vi.fn(async () => true),
      publishRevision: vi.fn(async (_id: number, expected: string, content: any) => {
        if (raw.content_key !== expected) return false
        Object.assign(raw, content)
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
      effects: vi.fn(async () => {})
    }) as MediaSnapshotService
    return { service, repo, raw, row, memory, settings }
  }

  it('preserves the fixed live body on failed publication and never deletes it', async () => {
    const fixture = await captureFixture()
    fixture.repo.publishRevision.mockResolvedValue(false)
    const deletion = vi.spyOn(fixture.memory.bucket, 'delete')
    expect(await fixture.service.settle({} as any, 1)).toBe(false)
    expect(await fixture.memory.bucket.head('html/body/owner.html')).not.toBeNull()
    expect(deletion).not.toHaveBeenCalled()
    expect(fixture.repo.releaseWrite).toHaveBeenCalledWith(1, fixture.raw.updated_at)
  })

  it('claims the DB request before any fixed-key writes', async () => {
    const fixture = await captureFixture()
    fixture.repo.claimWrite.mockResolvedValue(false)
    const writes = vi.spyOn(fixture.memory.bucket, 'put')
    expect(await fixture.service.settle({} as any, 1)).toBe(false)
    expect(writes).not.toHaveBeenCalled()
  })

  it("pins a first terminal failure instead of consuming another user's later retry", async () => {
    const fixture = await captureFixture()
    expect(await fixture.service.settle({} as any, 1)).toBe(true)
    const key = fixture.raw.content_key
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({} as any, 1)).toBe(false)
    expect(fixture.raw.content_key).toBe(key)
    expect((await fixture.service.load(1))?.media?.variants.en?.status).toBe('failed')
  })

  it('stores a ready supplemental article without replacing an annotated transcript', async () => {
    const fixture = await captureFixture(true)
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({} as any, 1)).toBe(true)
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
    expect(await fixture.service.settle({} as any, 1)).toBe(true)
    const saved = (await fixture.service.load(1))!.media!
    expect(saved.bodyLanguage).toBeNull()
    expect(saved.variants.en?.content?.lede).toBe('Ready article')
    expect(await (await fixture.memory.bucket.get(fixture.raw.content_key))?.text()).toContain('Original transcript')
  })

  it('promotes a pending YouTube article when current settings and marks allow it', async () => {
    const fixture = await captureFixture()
    fixture.row.status = 'ready'
    expect(await fixture.service.settle({} as any, 1)).toBe(true)
    expect((await fixture.service.load(1))!.media!.bodyLanguage).toBe('en')
    expect(await (await fixture.memory.bucket.get(fixture.raw.content_key))?.text()).toContain('Ready article')
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
