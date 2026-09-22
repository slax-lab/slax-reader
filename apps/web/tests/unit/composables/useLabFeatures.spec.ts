// useLabFeatures 组合函数单测
// fetch → useState；toggle 乐观切换 + 失败回滚；isBlocked 只在拉过列表后才拦；
// handleSaveError 只认 LAB_FEATURE_DISABLED，弹带“去打开”的 toast
import { RequestError } from '@commons/frontend-utils/request'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useLabFeatures } from '~~/app/composables/useLabFeatures'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost, mockRequest, mockToastShowToast, mockNavigateTo } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  return {
    mockGet,
    mockPost,
    mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost })),
    mockToastShowToast: vi.fn(),
    mockNavigateTo: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('navigateTo', () => mockNavigateTo)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

const youtube = () => ({ key: 'youtube', status: 'active' as const, enabled: false, enabled_at: null })

describe('useLabFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue('ok')
    // useState 在同一个 nuxt app 里跨用例共享，每个用例先清掉
    const labs = useLabFeatures()
    labs.features.value = []
    labs.loaded.value = false
  })

  describe('fetch', () => {
    it('GET /v1/user/labs → features + loaded', async () => {
      mockGet.mockResolvedValue({ features: [youtube()] })
      const labs = useLabFeatures()
      await labs.fetch()
      expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/labs' })
      expect(labs.features.value).toEqual([youtube()])
      expect(labs.loaded.value).toBe(true)
    })

    it('返回空 body → 空列表', async () => {
      mockGet.mockResolvedValue(undefined)
      const labs = useLabFeatures()
      await labs.fetch()
      expect(labs.features.value).toEqual([])
    })
  })

  describe('toggle', () => {
    it('关 → 开：先改本地再 POST enable，成功后写 enabled_at', async () => {
      const labs = useLabFeatures()
      labs.features.value = [youtube()]
      const pending = labs.toggle('youtube')
      expect(labs.isEnabled('youtube')).toBe(true)
      await pending
      expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting/enable', body: { key: 'lab:youtube' } })
      expect(labs.features.value[0]!.enabled_at).toMatch(/^\d{4}-/)
    })

    it('开 → 关：POST disable，enabled_at 清空', async () => {
      const labs = useLabFeatures()
      labs.features.value = [{ ...youtube(), enabled: true, enabled_at: '2026-09-08T00:00:00.000Z' }]
      await labs.toggle('youtube')
      expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting/disable', body: { key: 'lab:youtube' } })
      expect(labs.features.value[0]!).toMatchObject({ enabled: false, enabled_at: null })
    })

    it('失败 → 回滚 + toast', async () => {
      mockPost.mockRejectedValue(new Error('500'))
      const labs = useLabFeatures()
      labs.features.value = [youtube()]
      await labs.toggle('youtube')
      expect(labs.isEnabled('youtube')).toBe(false)
      expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'Operation failed', type: 'error' })
    })

    it('graduated 和未知 key 不发请求', async () => {
      const labs = useLabFeatures()
      labs.features.value = [{ ...youtube(), status: 'graduated', enabled: true }]
      await labs.toggle('youtube')
      await labs.toggle('nope')
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('isBlocked', () => {
    const videoUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=10',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ]

    it('没拉过列表 → 不拦', () => {
      const labs = useLabFeatures()
      expect(labs.isBlocked(videoUrls[0]!)).toBe(false)
    })

    it.each(videoUrls)('youtube 关着 → 拦 %s', url => {
      const labs = useLabFeatures()
      labs.features.value = [youtube()]
      labs.loaded.value = true
      expect(labs.isBlocked(url)).toBe(true)
    })

    it('youtube 开着 → 放行', () => {
      const labs = useLabFeatures()
      labs.features.value = [{ ...youtube(), enabled: true }]
      labs.loaded.value = true
      expect(labs.isBlocked(videoUrls[0]!)).toBe(false)
    })

    it.each(['https://example.com/post', 'https://www.youtube.com/@channel', 'https://www.youtube.com/playlist?list=PL123', 'not a url'])('非视频链接不拦 %s', url => {
      const labs = useLabFeatures()
      labs.features.value = [youtube()]
      labs.loaded.value = true
      expect(labs.isBlocked(url)).toBe(false)
    })

    it('blockedMessage 给出客户端文案', () => {
      const labs = useLabFeatures()
      expect(labs.blockedMessage(videoUrls[0]!)).toBe('YouTube videos are still in Labs. Turn it on in Settings, then save again')
      expect(labs.blockedMessage('https://example.com')).toBe('')
    })
  })

  describe('handleSaveError', () => {
    it('LAB_FEATURE_DISABLED → toast 带“去打开”，点击跳设置页', () => {
      const labs = useLabFeatures()
      const err = new RequestError({ message: 'YouTube videos are still in Labs', name: 'LAB_FEATURE_DISABLED', code: 400 })
      expect(labs.handleSaveError(err)).toBe(true)
      expect(mockToastShowToast).toHaveBeenCalledTimes(1)
      const options = mockToastShowToast.mock.calls[0]![0]
      expect(options).toMatchObject({ text: 'YouTube videos are still in Labs', type: 'error', duration: 6000, action: { text: 'Turn on' } })
      options.action.onClick()
      expect(mockNavigateTo).toHaveBeenCalledWith('/user#labs')
    })

    it('其它错误 → false，不弹', () => {
      const labs = useLabFeatures()
      expect(labs.handleSaveError(new RequestError({ message: 'x', name: 'ERROR_PARAM', code: 400 }))).toBe(false)
      expect(labs.handleSaveError(new Error('x'))).toBe(false)
      expect(mockToastShowToast).not.toHaveBeenCalled()
    })
  })
})
