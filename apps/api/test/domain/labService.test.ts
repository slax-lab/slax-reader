/**
 * Hosted Labs registry: which URLs are gated, and what the user sees when blocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LabService, type LabFeatureDef } from '@/domain/lab'
import { ErrorName } from '@/const/err'
import { setGlobalLanguage } from '@/utils/multiLangError'
import { createMockCtx } from '@test/helpers/mockFactory'

function wire(enabled = false) {
  const labRepo = {
    listByUser: vi.fn().mockResolvedValue([]),
    isEnabled: vi.fn().mockResolvedValue(enabled),
    upsert: vi.fn().mockResolvedValue(undefined)
  }
  const service = new (LabService as any)(labRepo) as LabService
  return { service, labRepo }
}

const YOUTUBE_URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://m.youtube.com/shorts/dQw4w9WgXcQ',
  'https://www.youtube.com/live/dQw4w9WgXcQ',
  'https://www.youtube.com/embed/dQw4w9WgXcQ'
]

describe('registry', () => {
  test('youtube is the only feature, listed as active', async () => {
    const { service } = wire()
    expect(await service.listForUser(1)).toEqual([{ key: 'youtube', status: 'active', enabled: false, enabled_at: null }])
  })

  test('GATED_ROUTES maps the youtube crawl route to the youtube switch', () => {
    expect(LabService.GATED_ROUTES).toEqual({ youtube: 'youtube' })
  })
})

describe('assertUrlAllowed', () => {
  beforeEach(() => setGlobalLanguage('en'))

  test.each(YOUTUBE_URLS)('blocks %s when the switch is off', async url => {
    const { service, labRepo } = wire(false)
    const err = await service.assertUrlAllowed(createMockCtx({ userId: 7 }), url).catch(e => e)
    expect(err.name).toBe(ErrorName.LAB_FEATURE_DISABLED)
    expect(err.errCode).toBe(400)
    expect(err.getMessage).toBe('YouTube videos are still in Labs. Turn it on in Settings, then save again')
    expect(labRepo.isEnabled).toHaveBeenCalledWith(7, 'youtube')
  })

  test('message follows the request language', async () => {
    const { service } = wire(false)
    const err = await service.assertUrlAllowed(createMockCtx(), YOUTUBE_URLS[0]).catch(e => e)
    setGlobalLanguage('zh')
    expect(err.getMessage).toBe('YouTube 视频还在实验室里，请到设置页打开后再保存')
    setGlobalLanguage('es')
    expect(err.getMessage).toBe('Los vídeos de YouTube todavía están en el Laboratorio. Actívalo en Ajustes y vuelve a guardar')
  })

  test.each(YOUTUBE_URLS)('lets %s through when the switch is on', async url => {
    const { service } = wire(true)
    await expect(service.assertUrlAllowed(createMockCtx(), url)).resolves.toBeUndefined()
  })

  test.each([
    'https://example.com/post',
    'https://x.com/slax/status/123',
    'https://www.youtube.com/@channel', // channel page: no video id, regular crawl
    'https://bit.ly/abc', // short links are resolved later in the workflow (known gap)
    'not a url'
  ])('ignores %s without reading the table', async url => {
    const { service, labRepo } = wire(false)
    await expect(service.assertUrlAllowed(createMockCtx(), url)).resolves.toBeUndefined()
    expect(labRepo.isEnabled).not.toHaveBeenCalled()
  })
})

/**
 * The hosted registry above is one configuration of the framework; these cases pin
 * the framework itself — the empty default registry, the graduated/retired statuses,
 * and gating by injected URL map.
 */
function createRepo() {
  return {
    listByUser: vi.fn().mockResolvedValue([]),
    isEnabled: vi.fn().mockResolvedValue(false),
    upsert: vi.fn().mockResolvedValue(undefined)
  }
}

class TestLabService extends LabService {
  constructor(
    repo: any,
    private defs: Record<string, LabFeatureDef>,
    private gated: Record<string, string> = {}
  ) {
    super(repo)
  }
  protected features() {
    return this.defs
  }
  protected gatedFeatureForUrl(url: string) {
    return Object.entries(this.gated).find(([host]) => new URL(url).hostname === host)?.[1] ?? null
  }
}

class EmptyLabService extends LabService {
  constructor(repo: any) {
    super(repo)
  }
  protected features() {
    return {}
  }
  protected gatedFeatureForUrl() {
    return null
  }
}

const defs: Record<string, LabFeatureDef> = {
  youtube: { status: 'active', name: { zh: 'YouTube 视频', en: 'YouTube videos' } },
  pdf: { status: 'graduated', name: { en: 'PDF files' }, graduatedAt: '2026-09-01' },
  podcast: { status: 'retired', name: { en: 'Podcasts' } }
}

describe('LabService with an empty registry (open-source default)', () => {
  const userId = 7

  test('lists nothing, blocks nothing, rejects every key', async () => {
    const repo = createRepo()
    const service = new EmptyLabService(repo)

    expect(await service.listForUser(userId)).toEqual([])
    expect(repo.listByUser).not.toHaveBeenCalled()
    expect(await service.isEnabled(userId, 'youtube')).toBe(false)
    await expect(service.setEnabled(userId, 'youtube', true)).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
    await expect(service.assertUrlAllowed({ getUserId: () => userId } as any, 'https://www.youtube.com/watch?v=abc')).resolves.toBeUndefined()
  })
})

describe('LabService.isEnabled', () => {
  const userId = 7

  test('active reads the user row, missing row means off', async () => {
    const repo = createRepo()
    const service = new TestLabService(repo, defs)

    expect(await service.isEnabled(userId, 'youtube')).toBe(false)
    expect(repo.isEnabled).toHaveBeenCalledWith(userId, 'youtube')

    repo.isEnabled.mockResolvedValue(true)
    expect(await service.isEnabled(userId, 'youtube')).toBe(true)
  })

  test('graduated is on for everyone, retired and unknown are off, without touching the table', async () => {
    const repo = createRepo()
    const service = new TestLabService(repo, defs)

    expect(await service.isEnabled(userId, 'pdf')).toBe(true)
    expect(await service.isEnabled(userId, 'podcast')).toBe(false)
    expect(await service.isEnabled(userId, 'nope')).toBe(false)
    expect(repo.isEnabled).not.toHaveBeenCalled()
  })
})

describe('LabService.setEnabled', () => {
  const userId = 7

  test('writes active and graduated keys, rejects retired and unknown keys', async () => {
    const repo = createRepo()
    const service = new TestLabService(repo, defs)

    await service.setEnabled(userId, 'youtube', true)
    expect(repo.upsert).toHaveBeenCalledWith(userId, 'youtube', true)

    await service.setEnabled(userId, 'pdf', false)
    expect(repo.upsert).toHaveBeenCalledWith(userId, 'pdf', false)

    await expect(service.setEnabled(userId, 'podcast', true)).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
    await expect(service.setEnabled(userId, 'nope', true)).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
    expect(repo.upsert).toHaveBeenCalledTimes(2)
  })
})

describe('LabService.listForUser', () => {
  const userId = 7

  test('returns active and graduated rows with the user state, hides retired', async () => {
    const repo = createRepo()
    const enabledAt = new Date('2026-09-08T01:02:03.000Z')
    repo.listByUser.mockResolvedValue([
      { feature: 'youtube', enabled: true, created_at: enabledAt, updated_at: enabledAt },
      { feature: 'podcast', enabled: true, created_at: enabledAt, updated_at: enabledAt }
    ])
    const service = new TestLabService(repo, defs)

    expect(await service.listForUser(userId)).toEqual([
      { key: 'youtube', status: 'active', enabled: true, enabled_at: '2026-09-08T01:02:03.000Z' },
      { key: 'pdf', status: 'graduated', enabled: true, enabled_at: null }
    ])
  })

  test('a switched-off row reports enabled=false with no enabled_at', async () => {
    const repo = createRepo()
    const at = new Date('2026-09-08T01:02:03.000Z')
    repo.listByUser.mockResolvedValue([{ feature: 'youtube', enabled: false, created_at: at, updated_at: at }])
    const service = new TestLabService(repo, defs)

    const [youtube] = await service.listForUser(userId)
    expect(youtube).toEqual({ key: 'youtube', status: 'active', enabled: false, enabled_at: null })
  })
})

describe('LabService.assertUrlAllowed with an injected registry', () => {
  const userId = 7
  const ctx = { getUserId: () => userId } as any
  const gated = { 'www.youtube.com': 'youtube', 'files.example.com': 'pdf', 'pod.example.com': 'podcast' }

  beforeEach(() => setGlobalLanguage('en'))

  test('throws LAB_FEATURE_DISABLED with the feature name when the switch is off', async () => {
    const service = new TestLabService(createRepo(), defs, gated)

    const err = await service.assertUrlAllowed(ctx, 'https://www.youtube.com/watch?v=abc').catch(e => e)
    expect(err.name).toBe(ErrorName.LAB_FEATURE_DISABLED)
    expect(err.errCode).toBe(400)
    expect(err.getMessage).toBe('YouTube videos are still in Labs. Turn it on in Settings, then save again')
    expect(LabService.isLabDisabledError(err)).toBe(true)

    setGlobalLanguage('zh')
    expect(err.getMessage).toBe('YouTube 视频还在实验室里，请到设置页打开后再保存')
  })

  test('passes when the switch is on, when the feature graduated, and for ungated or invalid URLs', async () => {
    const repo = createRepo()
    repo.isEnabled.mockResolvedValue(true)
    const service = new TestLabService(repo, defs, gated)

    await expect(service.assertUrlAllowed(ctx, 'https://www.youtube.com/watch?v=abc')).resolves.toBeUndefined()
    await expect(service.assertUrlAllowed(ctx, 'https://files.example.com/a.pdf')).resolves.toBeUndefined()
    await expect(service.assertUrlAllowed(ctx, 'https://example.com/post')).resolves.toBeUndefined()
    await expect(service.assertUrlAllowed(ctx, 'not a url')).resolves.toBeUndefined()
  })

  test('a retired feature blocks the URL for everyone', async () => {
    const service = new TestLabService(createRepo(), defs, gated)
    await expect(service.assertUrlAllowed(ctx, 'https://pod.example.com/ep1')).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
  })

  test('isLabDisabledError ignores other errors', () => {
    expect(LabService.isLabDisabledError(new Error('x'))).toBe(false)
    expect(LabService.isLabDisabledError(null)).toBe(false)
  })
})
