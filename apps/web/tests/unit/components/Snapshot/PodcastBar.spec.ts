// PodcastBar + usePodcast
// 覆盖：各阶段文案、轮询到完成即停、limit_reached 不再轮询、失败原因与重试、整理稿就绪自动换正文
// （播放中则等用户点）、译文就绪默认切到译文且用户选择优先、访客隐藏、卸载停轮询
import recoveryResponses from '../../../../../api/test/fixtures/podcast/recovery-status.json'
import PodcastBar from '~~/app/components/Snapshot/PodcastBar.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { podcastPhase } from '~~/app/composables/bookmark/usePodcast'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost, mockRequest } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  return { mockGet, mockPost, mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost })) }
})

mockNuxtImport('request', () => mockRequest)

const state = (o: Record<string, unknown> = {}) => ({
  transcript: 'pending',
  article: 'unavailable',
  body_ready: false,
  language: 'en',
  reason: null,
  translation: null,
  can_retry: false,
  ...o
})

const TRANSLATION = { version: 'v-zh', language: 'zh', lede: '导读', sections: [{ heading: '标题', start_ms: 0, paragraphs: [{ speaker: null, text: '译文', start_ms: 1000 }] }] }

function routeGet(statuses: unknown[]) {
  mockGet.mockImplementation(({ url }: { url: string }) => {
    if (url.endsWith('/translation')) return Promise.resolve(TRANSLATION)
    const next = statuses.length > 1 ? statuses.shift() : statuses[0]
    return Promise.resolve(next)
  })
}

const statusCalls = () => mockGet.mock.calls.filter(c => (c[0] as { url: string }).url.endsWith('/status')).length

const mount = (props: Record<string, unknown> = {}) => mountWithApp(PodcastBar, { props: { bookmarkUid: 'ub-1', bodyHasArticle: false, ...props }, attachTo: document.body })

describe('podcastPhase', () => {
  it('maps the status to what the line says', () => {
    expect(podcastPhase(null)).toBe('hidden')
    expect(podcastPhase(state({ transcript: 'unavailable' }) as never)).toBe('hidden')
    expect(podcastPhase(state({ reason: 'limit_reached' }) as never)).toBe('limit_reached')
    expect(podcastPhase(state() as never)).toBe('queued')
    expect(podcastPhase(state({ transcript: 'transcribing' }) as never)).toBe('transcribing')
    expect(podcastPhase(state({ transcript: 'skipped', reason: 'too_long' }) as never)).toBe('failed')
    expect(podcastPhase(state({ transcript: 'ready', article: 'generating' }) as never)).toBe('writing')
    expect(podcastPhase(state({ transcript: 'ready', article: 'pending' }) as never)).toBe('writing')
    expect(podcastPhase(state({ transcript: 'ready', article: 'failed' }) as never)).toBe('failed')
    expect(
      podcastPhase(
        state({
          transcript: 'ready',
          article: 'ready',
          body_ready: true
        }) as never
      )
    ).toBe('done')
    expect(podcastPhase(state({ transcript: 'ready', article: 'unavailable' }) as never)).toBe('hidden')
  })
})

describe('PodcastBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('polls through transcription and writing, then asks for the body once and stops', async () => {
    routeGet([state({ transcript: 'transcribing' }), state({ transcript: 'ready', article: 'generating' }), state({ transcript: 'ready', article: 'ready', body_ready: true })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('Transcribing the audio')
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.text()).toContain('Writing the readable transcript')
    await vi.advanceTimersByTimeAsync(8000)
    expect(w.emitted('refresh-body')).toHaveLength(1)
    const calls = statusCalls()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(calls)
  })

  it('status requests that keep failing say so and offer to check again', async () => {
    let down = false
    mockGet.mockImplementation(() => (down ? Promise.reject(new Error('down')) : Promise.resolve(state({ transcript: 'transcribing' }))))
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('Transcribing the audio')
    down = true
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.text()).toContain('Could not get the latest status.')
    expect(w.text()).not.toContain('Transcribing the audio')

    down = false
    await w.find('.pod-action').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Transcribing the audio')
    expect(w.text()).not.toContain('Could not get the latest status.')
    w.unmount()
  })

  it('a playing player is not interrupted: the reader gets a button instead', async () => {
    routeGet([state({ transcript: 'ready', article: 'generating' }), state({ transcript: 'ready', article: 'ready', body_ready: true })])
    const w = await mount()
    await flushPromises()
    window.dispatchEvent(new CustomEvent('slax:podcast-state', { detail: { playing: true } }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.emitted('refresh-body')).toBeUndefined()
    await w.find('.pod-action').trigger('click')
    expect(w.emitted('refresh-body')).toHaveLength(1)
  })

  it('limit reached: says so, offers a start, and does not poll', async () => {
    routeGet([state({ reason: 'limit_reached', can_retry: true })])
    mockPost.mockResolvedValue(state({ transcript: 'transcribing' }))
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('today’s limit of new episodes')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(1)
    await w.find('.pod-action').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/podcast/retry' }))
    expect(w.text()).toContain('Transcribing the audio')
  })

  it('a pending episode the owner can start (the next day): not "queued", a start button, no polling', async () => {
    routeGet([state({ can_retry: true })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('has not started')
    expect(w.find('.pod-action').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(1)
  })

  it('status ready but the body is not written yet: asks again a few times, then stops', async () => {
    routeGet([state({ transcript: 'ready', article: 'ready', body_ready: true })])
    const w = await mount()
    await flushPromises()
    expect(w.emitted('refresh-body')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(w.emitted('refresh-body')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.emitted('refresh-body')).toHaveLength(4)
    expect(w.text()).toContain('The readable transcript is ready')
  })

  it('a final reason is explained without retry; a failure with retry posts and polls again', async () => {
    routeGet([state({ transcript: 'skipped', reason: 'too_long' })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('Episodes up to 3 hours are supported')
    expect(w.find('.pod-action').exists()).toBe(false)
    w.unmount()

    routeGet([state({ transcript: 'failed', reason: 'asr_error', can_retry: true })])
    mockPost.mockResolvedValue(state({ transcript: 'pending' }))
    const w2 = await mount()
    await flushPromises()
    expect(w2.text()).toContain('Could not make the readable transcript')
    await w2.find('.pod-action').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/podcast/retry', body: { bookmark_uid: 'ub-1' } }))
    expect(w2.text()).toContain('The transcript is queued')
  })

  it.each(['transcript', 'article', 'translation'] as const)('shows and executes the API input-change recovery contract for %s', async stage => {
    const response = recoveryResponses[stage]
    expect(podcastPhase(response as never)).toBe(stage === 'translation' ? 'done' : 'failed')
    routeGet([response])
    mockPost.mockResolvedValue(state({ transcript: 'pending' }))
    const w = await mount({ bodyHasArticle: stage === 'translation' })
    await flushPromises()
    expect(w.find('.podcast-bar').exists()).toBe(true)
    const retry = w.find('.pod-action')
    expect(retry.exists()).toBe(true)
    expect(retry.attributes('disabled')).toBeUndefined()
    await retry.trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/podcast/retry', body: { bookmark_uid: 'ub-1' } }))
    w.unmount()
  })

  it('a ready translation switches the view once; the reader can switch back', async () => {
    routeGet([state({ transcript: 'ready', article: 'ready', body_ready: true, translation: { status: 'ready', language: 'zh', version: 'v-zh' } })])
    const w = await mount({ bodyHasArticle: true, mode: 'original', 'onUpdate:mode': (v: string) => w.setProps({ mode: v }) })
    await flushPromises()
    expect(w.emitted('translation')![0]).toEqual([TRANSLATION])
    expect(w.emitted('update:mode')!.at(-1)).toEqual(['translation'])
    const [original] = w.findAll('.pod-switch button')
    await original!.trigger('click')
    expect(w.emitted('update:mode')!.at(-1)).toEqual(['original'])
  })

  it('a translation in progress shows its own line', async () => {
    routeGet([state({ transcript: 'ready', article: 'ready', body_ready: true, translation: { status: 'generating', language: 'zh', version: null } })])
    const w = await mount({ bodyHasArticle: true })
    await flushPromises()
    expect(w.text()).toContain('Translating into Chinese')
  })

  it('unavailable (visitor, Labs off): nothing is shown; unmount stops polling', async () => {
    routeGet([state({ transcript: 'unavailable' })])
    const w = await mount()
    await flushPromises()
    expect(w.find('.podcast-bar').exists()).toBe(false)
    w.unmount()
    routeGet([state({ transcript: 'transcribing' })])
    const w2 = await mount()
    await flushPromises()
    w2.unmount()
    const calls = statusCalls()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(calls)
  })
})
