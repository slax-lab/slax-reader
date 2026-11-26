// SnapshotAIPanel.vue 单测
// 覆盖：overview / outline 双段并发自动加载、骨架、覆盖语义、key takeaways、
//      自动重试、错误重试按钮、缓存命中、空缓存流式、bookmarkId / shareCode 传参
// 关键约束（对齐 AISummaries.spec.ts 范式）：
//  - request 是 nuxt auto-import → mockNuxtImport('request', () => mockRequest)，返回 {get, stream}
//  - request().stream 真实协议：resolve 一个注册函数 callBack；callBack(handler:(text,isDone)=>void)
//  - overview / outline 都走 stream，断言时按 url 过滤；mockStream 按 url 分发返回值
//  - 每个用例 reset 后必须重装默认 URL 分发（mockReset 会清掉 implementation）
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockStream, mockRequest, mockExtractMarkdown } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockStream: vi.fn(),
  mockRequest: vi.fn(),
  mockExtractMarkdown: vi.fn((t: string) => t)
}))

mockRequest.mockImplementation(() => ({ get: mockGet, stream: mockStream }))
mockNuxtImport('request', () => mockRequest)

vi.mock('@commons/frontend-utils/text', () => ({
  extractMarkdownFromText: mockExtractMarkdown
}))
vi.mock('@commons/frontend-utils/parse', () => ({
  parseMarkdownText: vi.fn((t: string) => t)
}))

import SnapshotAIPanel from '~~/app/components/Snapshot/SnapshotAIPanel.vue'

const stubs = {
  MarkdownText: { name: 'MarkdownText', props: ['text'], template: '<div class="markdown-stub">{{ text }}</div>' },
  DotLoading: { name: 'DotLoading', template: '<div class="dot-loading-stub" />' }
}

// 过滤指定 url 的 stream 调用
const streamCallsFor = (url: string) => mockStream.mock.calls.filter((c: unknown[]) => (c[0] as { url: string }).url === url)

// 安装默认分发：overview / outline stream 都 resolve null（callBack 短路）
const installDefaultStream = () => {
  mockStream.mockImplementation(() => Promise.resolve(null))
}

beforeEach(() => {
  mockGet.mockReset()
  mockStream.mockReset()
  mockExtractMarkdown.mockImplementation((t: string) => t)
  installDefaultStream()
  mockGet.mockResolvedValue([])
})

describe('SnapshotAIPanel', () => {
  describe('加载触发', () => {
    it('isAppeared=false 时不触发任何加载', async () => {
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: false }, global: { stubs } })
      await flushPromises()
      expect(mockStream).not.toHaveBeenCalled()
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('isAppeared=true 时 overview 和 outline 并发启动（非阻塞）', async () => {
      // overview stream 保持 pending，断言 outline 的 GET 已被调用
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return new Promise(() => {}) // 永不 resolve
        }
        return Promise.resolve(null)
      })
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      // overview pending 期间，outline list GET 已被同步触发
      expect(mockGet).toHaveBeenCalled()
    })

    it('isAppeared=true 时自动触发 overview 加载', async () => {
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW).length).toBeGreaterThan(0)
    })

    it('displays an existing visitor outline without requesting the hidden overview', async () => {
      const wrapper = mountWithApp(SnapshotAIPanel, {
        props: { bookmarkUid: 'public-bookmark', overviewEnabled: false, defaultOutline: 'Public outline', isAppeared: true },
        global: { stubs }
      })
      await flushPromises()

      expect(wrapper.find('.panel-overview').exists()).toBe(false)
      expect(wrapper.find('.panel-outline-text').text()).toBe('Public outline')
      expect(mockStream).not.toHaveBeenCalled()
    })

    it('isAppeared=true 时自动触发 outline 加载，bookmarkId 模式 query 含 bookmark_id', async () => {
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 7, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ url: RESTMethodPath.BOOKMARK_AI_SUMMARIES_LIST, query: expect.objectContaining({ bookmark_id: 7 }) }))
    })
  })

  describe('overview', () => {
    it('overview 加载中显示骨架', async () => {
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) return new Promise(() => {})
        return Promise.resolve(null)
      })
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      expect(wrapper.find('.panel-overview .skeleton-row').exists()).toBe(true)
    })

    it('overview 加载完成显示内容（覆盖语义，非拼接）', async () => {
      let handler: ((text: string, done: boolean) => void) | null = null
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            handler = cb
          })
        }
        return Promise.resolve(null)
      })
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      handler!('{"type":"progress","data":{"overview":"first"}}\n', false)
      await flushPromises()
      expect(wrapper.find('.overview-loading-bottom').exists()).toBe(true)
      handler!('{"type":"progress","data":{"overview":"second"}}', true)
      await flushPromises()
      expect(wrapper.find('.panel-overview-text').text()).toBe('second')
      expect(wrapper.find('.overview-loading-bottom').exists()).toBe(false)
    })

    it('renders fragmented overview and takeaway frames and finishes on the done frame', async () => {
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('{"type":"pro', false)
            cb('gress","data":{"over', false)
            cb('view":"text"}}\n{"type":"progress","data":{"key_takeaways":["a","b","c"]}}\n', false)
            cb('{"type":"progress","data":{"done":true}}\n', false)
            cb('', true)
          })
        }
        return Promise.resolve(null)
      })
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.panel-overview-text').text()).toBe('text')
      expect(wrapper.findAll('.panel-keypoints li').length).toBe(3)
      expect(wrapper.find('.panel-overview .retry-btn').exists()).toBe(false)
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW)).toHaveLength(1)
    })

    it('overview 内容为空 → 自动重试一次（outline 用缓存隔离）', async () => {
      mockGet.mockResolvedValue([{ content: '# cached', is_self: true }]) // outline 走缓存，不发 stream
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('', true) // 空内容 done
          })
        }
        return Promise.resolve(null)
      })
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW).length).toBe(2)
    })

    it('overview 重试后仍为空 → 显示重试按钮，stream 共调用两次', async () => {
      mockGet.mockResolvedValue([{ content: '# cached', is_self: true }])
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('', true)
          })
        }
        return Promise.resolve(null)
      })
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.panel-overview .retry-btn').exists()).toBe(true)
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW).length).toBe(2)
    })

    it('overview stream error 帧 → 触发自动重试一次', async () => {
      mockGet.mockResolvedValue([{ content: '# cached', is_self: true }])
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('{"type":"error","message":"server error"}', true)
          })
        }
        return Promise.resolve(null)
      })
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW).length).toBe(2)
    })

    it('overview stream reject → 显示重试按钮，骨架消失', async () => {
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_OVERVIEW) return Promise.reject(new Error('network'))
        return Promise.resolve(null)
      })
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.panel-overview .retry-btn').exists()).toBe(true)
      expect(wrapper.find('.panel-overview .skeleton-row').exists()).toBe(false)
    })

    it('bookmarkId 正确传入 overview 请求体', async () => {
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 42, isAppeared: true }, global: { stubs } })
      await flushPromises()
      const calls = streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW)
      expect((calls[0]![0] as { body: Record<string, unknown> }).body).toMatchObject({ bookmark_id: 42 })
    })

    it('does not request overview for a share code alone', async () => {
      mountWithApp(SnapshotAIPanel, { props: { shareCode: 'sc1', isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW)).toHaveLength(0)
    })

    it.each([
      ['non-object payload', (consume: (text: string, done: boolean) => void) => consume('{"type":"progress","data":"UNAUTHORIZED"}\n', false)],
      ['unexpected JSON envelope', (consume: (text: string, done: boolean) => void) => consume('{"data":"UNAUTHORIZED","code":401}\n', false)],
      ['asynchronous read failure', () => { throw new Error('Stream interrupted') }]
    ])('settles loading on %s', async (_name, read) => {
      mockStream.mockResolvedValue((consume: (text: string, done: boolean) => void) => {
        const reading = Promise.resolve().then(() => read(consume))
        void reading.catch(() => {})
        return reading
      })
      const wrapper = mountWithApp(SnapshotAIPanel, {
        props: { bookmarkId: 1, defaultOutline: 'Cached outline', isAppeared: true },
        global: { stubs }
      })
      await flushPromises()

      expect(wrapper.find('.panel-overview .retry-btn').exists()).toBe(true)
      expect(wrapper.find('.panel-overview .skeleton-row').exists()).toBe(false)
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW)).toHaveLength(1)
      expect(mockStream.mock.calls[0]![0].signal?.aborted).toBe(true)
    })

    it('keeps the retry loading when the previous reader rejects after its done frame', async () => {
      mockStream.mockResolvedValueOnce(async (consume: (text: string, done: boolean) => void) => {
        consume('{"type":"progress","data":{"done":true}}\n', false)
        throw new Error('Connection closed after done')
      })
      mockStream.mockImplementation(() => new Promise(() => {}))
      const wrapper = mountWithApp(SnapshotAIPanel, {
        props: { bookmarkId: 1, defaultOutline: 'Cached outline', isAppeared: true },
        global: { stubs }
      })
      await flushPromises()

      expect(streamCallsFor(RESTMethodPath.BOOKMARK_OVERVIEW)).toHaveLength(2)
      expect(wrapper.find('.panel-overview .skeleton-row').exists()).toBe(true)
      expect(wrapper.find('.panel-overview .retry-btn').exists()).toBe(false)
    })
  })

  describe('outline', () => {
    it('outline 加载中显示骨架', async () => {
      mockGet.mockImplementation(() => new Promise(() => {})) // GET pending
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      expect(wrapper.find('.panel-outline .skeleton-row').exists()).toBe(true)
    })

    it('outline 缓存命中 → 直接展示，不触发 stream', async () => {
      mockGet.mockResolvedValue([{ content: '# Section\n- item', is_self: true }])
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      const outlineMd = wrapper.find('.panel-outline .markdown-stub')
      expect(outlineMd.exists()).toBe(true)
      expect(streamCallsFor(RESTMethodPath.BOOKMARK_AI_SUMMARIES).length).toBe(0)
    })

    it('outline 空缓存后触发 stream 生成，body 含 bm_id', async () => {
      mockGet.mockResolvedValue([])
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_AI_SUMMARIES) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('# generated', true)
          })
        }
        return Promise.resolve(null)
      })
      mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 5, isAppeared: true }, global: { stubs } })
      await flushPromises()
      const calls = streamCallsFor(RESTMethodPath.BOOKMARK_AI_SUMMARIES)
      expect(calls.length).toBeGreaterThan(0)
      expect((calls[0]![0] as { method: string; body: Record<string, unknown> }).body).toMatchObject({ bm_id: 5 })
    })

    it('outline 加载完成显示 MarkdownText', async () => {
      mockGet.mockResolvedValue([{ content: '# Section', is_self: true }])
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.panel-outline .markdown-stub').text()).toBe('# Section')
    })

    it('shareCode 正确传入 outline GET 请求', async () => {
      mountWithApp(SnapshotAIPanel, { props: { shareCode: 'sc2', isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ share_code: 'sc2' }) }))
    })

    it('shareCode 模式 outline 空缓存后 stream body 含 share_code（不是 bm_id）', async () => {
      mockGet.mockResolvedValue([])
      mockStream.mockImplementation((opts: { url: string }) => {
        if (opts.url === RESTMethodPath.BOOKMARK_AI_SUMMARIES) {
          return Promise.resolve((cb: (text: string, done: boolean) => void) => {
            cb('# generated', true)
          })
        }
        return Promise.resolve(null)
      })
      mountWithApp(SnapshotAIPanel, { props: { shareCode: 'sc3', isAppeared: true }, global: { stubs } })
      await flushPromises()
      const calls = streamCallsFor(RESTMethodPath.BOOKMARK_AI_SUMMARIES)
      const body = (calls[0]![0] as { body: Record<string, unknown> }).body
      expect(body).toMatchObject({ share_code: 'sc3' })
      expect(body).not.toHaveProperty('bm_id')
    })

    it('outline GET reject → 显示重试按钮，骨架消失', async () => {
      mockGet.mockRejectedValue(new Error('network'))
      const wrapper = mountWithApp(SnapshotAIPanel, { props: { bookmarkId: 1, isAppeared: true }, global: { stubs } })
      await flushPromises()
      expect(wrapper.find('.panel-outline .retry-btn').exists()).toBe(true)
      expect(wrapper.find('.panel-outline .skeleton-row').exists()).toBe(false)
    })
  })
})
