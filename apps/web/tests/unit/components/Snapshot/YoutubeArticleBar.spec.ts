// YoutubeArticleBar: the slim status line of a YouTube bookmark whose body becomes the AI article
// 覆盖：生成中的状态、就绪后换正文（只问几次、视频播放时等用户点）、带划线回退到正文下方、
// 正文一直没到也回退、不请求整理稿内容、跳过与重试按钮、访客无状态时隐藏、卸载停轮询
import YoutubeArticleBar from '~~/app/components/Snapshot/YoutubeArticleBar.vue'

import { PODCAST_EVENTS } from '~~/app/utils/podcastMedia'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost, mockRequest } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  return { mockGet, mockPost, mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost })) }
})

mockNuxtImport('request', () => mockRequest)

const state = (o: Record<string, unknown> = {}) => ({
  status: 'pending',
  language: 'en',
  requested_language: 'en',
  eligibility: { decision: 'generate', reason_codes: [] },
  version: null,
  format: null,
  can_generate: false,
  can_retry: false,
  article_url: null,
  updated_at: '2026-10-14T00:00:00Z',
  body_mode: 'article',
  body_ready: false,
  ...o
})
const ready = (o: Record<string, unknown> = {}) => state({ status: 'ready', version: 'abc-en-1-v1', format: 'article', body_ready: true, ...o })

function routeGet(statuses: unknown[]) {
  mockGet.mockImplementation(() => Promise.resolve(statuses.length > 1 ? statuses.shift() : statuses[0]))
}

const contentCalls = () => mockGet.mock.calls.filter(c => (c[0] as { url: string }).url.endsWith('/content')).length

const mount = (props: Record<string, unknown> = {}) => mountWithApp(YoutubeArticleBar, { props: { bookmarkUid: 'ub-1', bodyHasArticle: false, ...props }, attachTo: document.body })

describe('YoutubeArticleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows an initial request failure and restarts status polling', async () => {
    mockGet.mockRejectedValue(new Error('network'))
    const w = await mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(6000)
    expect(w.text()).toContain('Could not load the article.')
    mockGet.mockResolvedValue(state({ status: 'generating' }))
    await w.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Preparing the article')
    expect(w.text()).not.toContain('Could not load the article.')
    expect(mockPost).not.toHaveBeenCalled()
    w.unmount()
  })

  it('keeps the failure line and its button while the retried status request is in flight', async () => {
    mockGet.mockRejectedValue(new Error('network'))
    const w = await mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(6000)
    expect(w.text()).toContain('Could not load the article.')
    // The retried request fails again after the backoff: nothing must vanish in between
    mockGet.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('network')), 1000)))
    await w.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(w.find('.youtube-article-bar').exists()).toBe(true)
    expect(w.text()).toContain('Could not load the article.')
    expect(w.find('.yt-status-action').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(w.text()).toContain('Could not load the article.')
    w.unmount()
  })

  it.each(['labs_disabled', 'source_missing'])('shows owner recovery guidance for %s', async reason => {
    routeGet([state({ status: 'unavailable', unavailable_reason: reason })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain(reason === 'labs_disabled' ? 'Enable YouTube AI articles' : 'Save the source link again')
    w.unmount()
  })

  it('does not render a translation key for an unknown recovery reason', async () => {
    routeGet([state({ status: 'unavailable', unavailable_reason: 'future_reason' })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).not.toContain('component.youtube_article.future_reason')
    w.unmount()
  })

  it('shows the work in progress, then asks for the body once it is written; never loads the article itself', async () => {
    routeGet([state(), state({ status: 'generating' }), ready()])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('Preparing the article')
    await vi.advanceTimersByTimeAsync(2000)
    expect(w.text()).toContain('Preparing the article')
    expect(w.emitted('refresh-body')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(4000)
    expect(w.emitted('refresh-body')).toHaveLength(1)
    expect(w.text()).toContain('The article is ready.')
    expect(contentCalls()).toBe(0)
    expect(w.emitted('fallback')).toBeUndefined()

    // ready: polling stops
    const calls = mockGet.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockGet.mock.calls.length).toBe(calls)
    w.unmount()
  })

  it('the body that never arrives: a few tries 15 s apart, then the article below the body', async () => {
    routeGet([ready()])
    const w = await mount()
    await flushPromises()
    expect(w.emitted('refresh-body')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15_000 * 3)
    expect(w.emitted('refresh-body')).toHaveLength(4)
    expect(w.emitted('fallback')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(w.emitted('refresh-body')).toHaveLength(4)
    expect(w.emitted('fallback')).toHaveLength(1)
    w.unmount()
  })

  it('a playing video is not interrupted: the reader gets a button instead', async () => {
    routeGet([state({ status: 'generating' }), ready()])
    const w = await mount()
    await flushPromises()
    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.state, { detail: { playing: true } }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(w.emitted('refresh-body')).toBeUndefined()
    await w.find('.yt-status-action').trigger('click')
    expect(w.emitted('refresh-body')).toHaveLength(1)
    w.unmount()
  })

  it('checks for the body again when the video stops playing', async () => {
    routeGet([state({ status: 'generating' }), ready()])
    const w = await mount()
    await flushPromises()
    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.state, { detail: { playing: true } }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(w.emitted('refresh-body')).toBeUndefined()
    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.state, { detail: { playing: false } }))
    expect(w.emitted('refresh-body')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(w.emitted('refresh-body')).toHaveLength(2)
    w.unmount()
  })

  it('marks on the raw transcript: falls back to the article below the body at once', async () => {
    routeGet([state({ status: 'generating', body_mode: 'transcript' })])
    const w = await mount()
    await flushPromises()
    expect(w.emitted('fallback')).toHaveLength(1)
    w.unmount()
  })

  it('a ready article that is not the body (a visitor in another language) falls back too', async () => {
    routeGet([ready({ body_ready: false })])
    const w = await mount()
    await flushPromises()
    expect(w.emitted('fallback')).toHaveLength(1)
    expect(w.emitted('refresh-body')).toBeUndefined()
    w.unmount()
  })

  it('a body that holds the owner article, read by a visitor in another language: falls back to the article below', async () => {
    routeGet([ready({ language: 'zh', requested_language: 'zh', body_ready: false })])
    const w = await mount({ bodyHasArticle: true })
    await flushPromises()
    expect(w.emitted('fallback')).toHaveLength(1)
    w.unmount()
  })

  it("a body that holds this viewer's article: the bar shows nothing and does not fall back", async () => {
    routeGet([ready()])
    const w = await mount({ bodyHasArticle: true })
    await flushPromises()
    expect(w.find('.youtube-article-bar').exists()).toBe(false)
    expect(w.emitted('fallback')).toBeUndefined()
    expect(w.emitted('refresh-body')).toBeUndefined()
    w.unmount()
  })

  it('skipped and failed keep their actions; unavailable shows nothing', async () => {
    routeGet([state({ status: 'skipped', can_generate: true })])
    mockPost.mockResolvedValue(state({ status: 'pending' }))
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain('relies on visuals')
    await w.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ body: { bookmark_uid: 'ub-1' } }))
    expect(w.text()).toContain('Preparing the article')
    w.unmount()

    routeGet([state({ status: 'failed', can_retry: true })])
    const f = await mount()
    await flushPromises()
    expect(f.text()).toContain('Could not generate the article.')
    expect(f.find('.yt-status-action').exists()).toBe(true)
    f.unmount()

    routeGet([state({ status: 'unavailable', body_mode: 'transcript' })])
    const u = await mount()
    await flushPromises()
    expect(u.find('.youtube-article-bar').exists()).toBe(false)
    expect(u.emitted('fallback')).toBeUndefined()
    u.unmount()
  })

  it('stops polling when unmounted', async () => {
    routeGet([state({ status: 'generating' })])
    const w = await mount()
    await flushPromises()
    w.unmount()
    const calls = mockGet.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockGet.mock.calls.length).toBe(calls)
  })
})
