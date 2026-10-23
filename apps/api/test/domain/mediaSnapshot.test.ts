import { describe, expect, it, vi } from 'vitest'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { podcastInputFingerprint } from '@/utils/mediaSnapshot'
import { SnapshotBundle } from '@/utils/snapshotBundle'
import { memoryBucket } from '../utils/snapshotBucket'

describe('private media publication', () => {
  async function captureFixture(marked = false) {
    const memory = memoryBucket()
    const raw: any = { id: 1, content_key: 'snapshots/owner/old/body.html', private_user: 7, userBookmarks: [{ uuid: 'owner' }] }
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
    await memory.bucket.put(raw.content_key, '<article>Original transcript</article>')
    await memory.bucket.put(raw.content_key.replace('body.html', 'media.json'), JSON.stringify(manifest))
    const row = { status: 'failed', target_language: 'en', error_message: 'quality', article_key: 'canonical.json', caption_key: 'captions.json' }
    await memory.bucket.put('canonical.json', JSON.stringify({ schema_version: 1, language: 'en', format: 'article', lede: 'Ready article', sections: [] }))
    await memory.bucket.put('captions.json', JSON.stringify({ cues: [] }))
    const repo = {
      snapshot: vi.fn(async () => raw),
      mediaDenied: vi.fn(async () => false),
      publishRevision: vi.fn(async (_id: number, expected: string, content: any) => {
        if (raw.content_key !== expected) return false
        Object.assign(raw, content)
        return true
      })
    }
    const settings = { enabled: true, language: 'en' }
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      cleanup: { registerBundle: async () => {} },
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

  it('discards only its own attempt when a newer owner revision wins the CAS', async () => {
    const fixture = await captureFixture()
    fixture.repo.publishRevision.mockResolvedValue(false)
    expect(await fixture.service.settle({} as any, 1)).toBe(false)
    expect([...fixture.memory.objects.keys()].filter(key => key.startsWith('snapshots/'))).toHaveLength(2)
    expect(fixture.raw.content_key).toBe('snapshots/owner/old/body.html')
  })

  it('pins the inputs returned by this acquisition rather than another save during initialization', async () => {
    const captured: any = { audio_url: 'audio', title: 'A', show_name: 'Show A', shownotes: 'Notes A', duration_sec: 10, publisher_transcripts: [], language: 'en' }
    const later = { ...captured, title: 'B', shownotes: 'Notes B' }
    const episodes = { findBySourceId: vi.fn(async () => later) }
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      cleanup: { registerBundle: async () => {} },
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
    const key = 'snapshots/source/first/body.html'
    await bucket.put(key, '<article>Source transcript</article>')
    await bucket.put(
      key.replace('body.html', 'media.json'),
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
      })
    )
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      cleanup: { registerBundle: async () => {} },
      bucket: () => ({ R2Bucket: bucket }),
      repo: { mediaDenied: vi.fn(async () => false) }
    }) as MediaSnapshotService
    const bundle = new SnapshotBundle(bucket, 'destination', async () => {})
    const result = await service.copyForFork({ id: 1, content_key: key, private_user: 1 } as any, bundle)
    expect(result).toEqual({ ref: { media_kind: 'youtube', source_id: 'video', source_hash: 'hash' }, input: undefined })
    await bucket.delete([key, key.replace('body.html', 'media.json')])
    const own = await (await bucket.get(`snapshots/destination/${bundle.attempt}/media.json`))!.json<any>()
    expect(own.mode).toBe('fork')
    expect(own.variants.en.status).toBe('unavailable')
    expect(own.bodyLanguage).toBeNull()
  })

  it('does not discard objects after an uncertain revision commit', async () => {
    const memory = memoryBucket()
    await memory.bucket.put('snapshots/owner/old/body.html', '<article>old</article>')
    const repo = {
      publishRevision: vi.fn(async () => {
        throw new Error('COMMIT timeout')
      }),
      snapshot: vi.fn(async () => {
        throw new Error('offline')
      })
    }
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      cleanup: { registerBundle: async () => {} },
      bucket: () => ({ R2Bucket: memory.bucket }),
      repo
    }) as MediaSnapshotService
    await expect(
      service.publish({ raw: { id: 1, content_key: 'snapshots/owner/old/body.html', userBookmarks: [{ uuid: 'owner' }] } } as any, null, {
        html: '<article>new</article>',
        text: 'new'
      })
    ).rejects.toThrow()
    expect([...memory.objects.keys()].filter(key => !key.includes('/old/'))).toHaveLength(3)
  })
})
