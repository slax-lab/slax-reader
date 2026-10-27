// YoutubeAiArticle + useYoutubeArticle
// 覆盖：七种状态的展示、轮询退避与 10 分钟上限、ready 后停止、生成与重试、访客语言提示、
// XSS 样本不执行、章节时间点击与键盘跳转、原始字幕折叠开关、卸载后停止轮询
import YoutubeAiArticle from '~~/app/components/Snapshot/YoutubeAiArticle.vue'

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

const state = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides
})

const ready = (overrides: Record<string, unknown> = {}) => state({ status: 'ready', version: 'abc-en-1-v1', format: 'article', ...overrides })

const ARTICLE = {
  version: 'abc-en-1-v1',
  language: 'en',
  format: 'article',
  lede: 'Lede.',
  sections: [{ heading: 'Intro', start_ms: 420000, paragraphs: [{ speaker: null, text: 'Body text.' }] }]
}

// Routes GET calls: status answers come from a queue, content from a fixed reply
function routeGet(statuses: unknown[], content: unknown = ARTICLE) {
  mockGet.mockImplementation(({ url }: { url: string }) => {
    if (url.endsWith('/content')) return Promise.resolve(content)
    const next = statuses.length > 1 ? statuses.shift() : statuses[0]
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  })
}

const statusCalls = () => mockGet.mock.calls.filter(c => (c[0] as { url: string }).url.endsWith('/status')).length

const mount = (props: Record<string, unknown> = {}) => mountWithApp(YoutubeAiArticle, { props: { bookmarkUid: 'ub-1', ...props }, attachTo: document.body })

describe('YoutubeAiArticle', () => {
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

  it.each(['labs_disabled', 'source_missing'])('shows owner recovery guidance for %s', async reason => {
    routeGet([state({ status: 'unavailable', unavailable_reason: reason })])
    const w = await mount()
    await flushPromises()
    expect(w.text()).toContain(reason === 'labs_disabled' ? 'Enable YouTube AI articles' : 'Save the source link again')
    w.unmount()
  })

  it('unavailable → renders nothing and does not poll', async () => {
    routeGet([state({ status: 'unavailable', language: null })])
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.youtube-ai-article').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(1)
  })

  it('pending → spinner; polls at 2, 4, 8, 15 s; ready → loads the article once, emits ready, stops', async () => {
    routeGet([state(), state(), state({ status: 'generating' }), state({ status: 'validating' }), ready()])
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-status').text()).toContain('Preparing the article')
    expect(mockGet.mock.calls[0]![0]).toMatchObject({ query: { bookmark_uid: 'ub-1' } })

    for (const [delay, expected] of [
      [1999, 1],
      [1, 2],
      [4000, 3],
      [8000, 4],
      [15000, 5]
    ] as const) {
      await vi.advanceTimersByTimeAsync(delay)
      expect(statusCalls()).toBe(expected)
    }
    await flushPromises()

    expect(wrapper.find('.yt-ai-body').text()).toContain('Body text.')
    expect(wrapper.emitted('ready')).toEqual([[true]])
    const contentCalls = mockGet.mock.calls.filter(c => (c[0] as { url: string }).url.endsWith('/content'))
    expect(contentCalls).toHaveLength(1)
    expect(contentCalls[0]![0]).toMatchObject({ query: { bookmark_uid: 'ub-1', version: 'abc-en-1-v1' } })

    await vi.advanceTimersByTimeAsync(120_000)
    expect(statusCalls()).toBe(5)
  })

  it('still working after 10 minutes → stops polling and says so', async () => {
    routeGet([state({ status: 'generating' })])
    const wrapper = mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    const calls = statusCalls()
    expect(wrapper.find('.yt-status').text()).toContain('taking longer than usual')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(statusCalls()).toBe(calls)
    expect(calls).toBeLessThan(50)
  })

  it('a failed poll shows no error and keeps polling', async () => {
    routeGet([state(), new Error('network'), ready()])
    mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    expect(statusCalls()).toBe(3)
    for (const call of mockGet.mock.calls) expect(typeof (call[0] as { errorInterceptors?: unknown }).errorInterceptors).toBe('function')
  })

  it('skipped with can_generate → "Generate anyway" posts generate and resumes polling', async () => {
    routeGet([state({ status: 'skipped', can_generate: true, eligibility: { decision: 'skip', reason_codes: ['x'] } }), ready()])
    mockPost.mockResolvedValue(state())
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-status').text()).toContain('relies on visuals')
    await wrapper.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/youtube_article/generate', body: { bookmark_uid: 'ub-1' } })
    expect(wrapper.find('.yt-status').text()).toContain('Preparing')
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(wrapper.find('.yt-ai-body').exists()).toBe(true)
  })

  it('skipped without can_generate (visitor or daily limit) → no button', async () => {
    routeGet([state({ status: 'skipped' })])
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-status-action').exists()).toBe(false)
  })

  it('failed with can_retry → "Retry" posts retry', async () => {
    routeGet([state({ status: 'failed', can_retry: true })])
    mockPost.mockResolvedValue(state())
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-status').text()).toContain('Could not generate')
    await wrapper.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/youtube_article/retry', body: { bookmark_uid: 'ub-1' } })
  })

  it('limit_reached → the daily limit message', async () => {
    routeGet([state({ status: 'limit_reached' })])
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-status').text()).toContain('Daily limit reached')
  })

  it('a visitor reading another language gets a note', async () => {
    routeGet([ready({ language: 'en', requested_language: 'zh' })])
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-ai-note').text()).toBe('This article is in English')
  })

  it('model text with markup is shown as text and never runs', async () => {
    const evil = {
      ...ARTICLE,
      lede: '<img src=x onerror="window.__pwned=1">',
      sections: [
        { heading: '<script>window.__pwned=1</script>', start_ms: 0, paragraphs: [{ speaker: '<b onclick="window.__pwned=1">x</b>', text: '<a href="javascript:alert(1)">l</a>' }] }
      ]
    }
    routeGet([ready()], evil)
    const wrapper = mount()
    await flushPromises()
    const body = wrapper.find('.yt-ai-body')
    expect(body.findAll('script, img, b')).toHaveLength(0)
    expect(body.findAll('a').every(a => /^#yt-expanded-topic-\d+$/.test(a.attributes('href')))).toBe(true)
    expect(body.find('.yt-ai-lede').text()).toBe('<img src=x onerror="window.__pwned=1">')
    expect(body.find('.yt-ai-heading span').text()).toBe('<script>window.__pwned=1</script>')
    ;(body.find('.yt-ai-speaker').element as HTMLElement).click()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('renders lede, headings, speakers and paragraphs', async () => {
    routeGet([ready()], {
      ...ARTICLE,
      format: 'dialogue',
      sections: [
        {
          heading: 'Talk',
          start_ms: 3725000,
          paragraphs: [
            { speaker: 'Ann', text: 'Hello.' },
            { speaker: null, text: 'Plain.' }
          ]
        }
      ]
    })
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-ai-lede').text()).toBe('Lede.')
    expect(wrapper.find('.yt-ai-time').text()).toBe('1:02:05')
    expect(wrapper.findAll('.yt-ai-paragraph').map(p => p.text())).toEqual(['Ann Hello.', 'Plain.'])
    expect(wrapper.find('.yt-ai-body').attributes()).toMatchObject({ lang: 'en', 'data-format': 'dialogue' })
  })

  it('chapter times are buttons that seek the player', async () => {
    routeGet([ready()])
    const seeks: number[] = []
    const onSeek = (e: Event) => seeks.push((e as CustomEvent<{ t: number }>).detail.t)
    window.addEventListener('slax:youtube-seek', onSeek)
    const wrapper = mount()
    await flushPromises()
    const time = wrapper.find('button.yt-ai-time')
    expect(time.text()).toBe('7:00')
    expect(time.attributes('aria-label')).toBe('Jump to 7:00')
    await time.trigger('click')
    await wrapper.find('.yt-ai-paragraph').trigger('click')
    expect(seeks).toEqual([420])
    window.removeEventListener('slax:youtube-seek', onSeek)
  })

  it('the transcript toggle follows the prop and emits toggle-transcript', async () => {
    routeGet([ready()])
    const wrapper = mount({ transcriptShown: false })
    await flushPromises()
    expect(wrapper.find('.yt-ai-link').text()).toBe('Show original transcript')
    await wrapper.find('.yt-ai-link').trigger('click')
    expect(wrapper.emitted('toggle-transcript')).toHaveLength(1)
    await wrapper.setProps({ transcriptShown: true })
    expect(wrapper.find('.yt-ai-link').text()).toBe('Hide original transcript')
  })

  it('no transcript in the body → no toggle', async () => {
    routeGet([ready()])
    const wrapper = mount({ hasTranscript: false })
    await flushPromises()
    expect(wrapper.find('.yt-ai-link').exists()).toBe(false)
  })

  it('a failed content load is retried; the article appears once it loads', async () => {
    let contentFails = 1
    mockGet.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith('/content')) return contentFails-- > 0 ? Promise.reject(new Error('blip')) : Promise.resolve(ARTICLE)
      return Promise.resolve(ready())
    })
    const wrapper = mount()
    await flushPromises()
    expect(wrapper.find('.yt-ai-body').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(wrapper.find('.yt-ai-body').text()).toContain('Body text.')
    const calls = mockGet.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mockGet.mock.calls.length).toBe(calls)
  })

  it('a failed first status request is retried, and polling gives up after 3 failures in a row', async () => {
    routeGet([new Error('down')])
    const wrapper = mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(3)
    expect(wrapper.text()).toContain('Could not load the article.')

    vi.clearAllMocks()
    routeGet([new Error('down'), ready()])
    const second = mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(second.find('.yt-ai-body').exists()).toBe(true)
  })

  it('a ready article whose content keeps failing offers a retry instead of an empty section', async () => {
    routeGet([ready()], null)
    const wrapper = mount()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load the article.')

    routeGet([ready()])
    await wrapper.find('.yt-status-action').trigger('click')
    await flushPromises()
    expect(wrapper.find('.yt-ai-body').text()).toContain('Body text.')
    expect(wrapper.text()).not.toContain('Could not load the article.')
  })

  it('status messages live in one region that stays in the DOM; aria-busy clears after the timeout', async () => {
    routeGet([state({ status: 'generating' })])
    const wrapper = mount()
    await flushPromises()
    const region = wrapper.find('[role="status"]')
    expect(region.attributes('aria-live')).toBe('polite')
    expect(wrapper.find('.youtube-ai-article').attributes('aria-busy')).toBe('true')
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(wrapper.find('[role="status"]').element).toBe(region.element)
    expect(wrapper.find('.youtube-ai-article').attributes('aria-busy')).toBe('false')
  })

  it('the transcript toggle reports its state with aria-expanded', async () => {
    routeGet([ready()])
    const wrapper = mount({ transcriptShown: true })
    await flushPromises()
    expect(wrapper.find('.yt-ai-link').attributes('aria-expanded')).toBe('true')
  })

  it('unmounting while ready tells the page to unfold the transcript', async () => {
    routeGet([ready()])
    const onReady = vi.fn()
    const wrapper = mount({ onReady })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(onReady.mock.calls).toEqual([[true]])
    wrapper.unmount()
    expect(onReady.mock.calls).toEqual([[true], [false]])
  })

  it('unmount stops polling', async () => {
    routeGet([state()])
    const wrapper = mount()
    await flushPromises()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(1)
  })
})
