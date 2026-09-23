// adapters 单测合集 —— 第五期 Sprint G（phase6 准备）
// 覆盖：DwebBookmarkProvider / DwebToastService / DwebUserProvider / DwebHttpClient
// 这 4 个 class 都是 @slax-reader/selection 适配器层，逻辑简单（构造存值 + 转发）
// 注意：DwebI18nService 不在此 spec — 它显式 from '#app' import useNuxtApp，
//       vi.mock('#app') 会破坏 setupNuxt 内部依赖；该文件 1 行 t() 转发，列 phase6
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ToastType } from '@slax-reader/selection/adapters'
import { DwebBookmarkProvider } from '~~/app/components/Article/Selection/adapters/DwebBookmarkProvider'
import { DwebHttpClient } from '~~/app/components/Article/Selection/adapters/DwebHttpClient'
import { DwebToastService } from '~~/app/components/Article/Selection/adapters/DwebToastService'
import { DwebUserProvider } from '~~/app/components/Article/Selection/adapters/DwebUserProvider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToastShowToast, mockCursorToastShowToast, mockUseNuxtApp, mockUseUserStore, mockGet, mockPost, mockPut, mockDelete, mockRequest, mockUseRuntimeConfig } = vi.hoisted(
  () => {
    const mockGet = vi.fn(async () => ({ ok: true }))
    const mockPost = vi.fn(async () => ({ ok: true }))
    const mockPut = vi.fn(async () => ({ ok: true }))
    const mockDelete = vi.fn(async () => ({ ok: true }))
    return {
      mockToastShowToast: vi.fn(),
      mockCursorToastShowToast: vi.fn(),
      mockUseNuxtApp: vi.fn(() => ({ $i18n: { t: (k: string) => `i18n:${k}` } })),
      mockUseUserStore: vi.fn(() => ({
        userInfo: { userId: 1, name: 'N', email: 'e@x.com', picture: 'p.png' } as { userId: number; name: string; email: string; picture: string } | null
      })),
      mockGet,
      mockPost,
      mockPut,
      mockDelete,
      mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost, put: mockPut, delete: mockDelete })),
      mockUseRuntimeConfig: vi.fn(() => ({ app: { baseURL: '/' }, public: {} }))
    }
  }
)

vi.mock('~~/app/components/Toast', () => ({
  default: { showToast: mockToastShowToast }
}))
vi.mock('~~/app/components/CursorToast', () => ({
  default: { showToast: mockCursorToastShowToast }
}))
vi.mock('~~/app/stores/user', () => ({
  useUserStore: mockUseUserStore
}))

// 不测 DwebI18nService（直接 from '#app' import useNuxtApp，
// 用 vi.mock('#app') 会破坏 setupNuxt 的依赖；该文件仅 1 行 t() 转发，价值极低，
// 列入 phase6 e2e 即可——但本期 exclude 它即可）

mockNuxtImport('useRuntimeConfig', () => mockUseRuntimeConfig)
mockNuxtImport('request', () => mockRequest)

beforeEach(() => {
  mockToastShowToast.mockClear()
  mockCursorToastShowToast.mockClear()
  mockGet.mockClear()
  mockPost.mockClear()
  mockPut.mockClear()
  mockDelete.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Selection/adapters', () => {
  describe('DwebBookmarkProvider', () => {
    it('构造保存全部字段', () => {
      const p = new DwebBookmarkProvider({ bookmarkId: 7, shareCode: 'sc', collection: { code: 'c', cb_id: 9 }, ownerUserId: 42 })
      expect((p as unknown as { bookmarkId: number }).bookmarkId).toBe(7)
    })

    it('getBookmarkId：bookmarkId 配置时返回该值', async () => {
      const p = new DwebBookmarkProvider({ bookmarkId: 1 })
      await expect(p.getBookmarkId()).resolves.toBe(1)
    })

    it('getBookmarkId：未配置时抛错', async () => {
      const p = new DwebBookmarkProvider({})
      await expect(p.getBookmarkId()).rejects.toThrow('BookmarkId is not configured')
    })

    it('getShareCode / getCollectionInfo / getOwnerUserId 返回构造值', () => {
      const p = new DwebBookmarkProvider({ shareCode: 'X', collection: { code: 'C', cb_id: 99 }, ownerUserId: 8 })
      expect(p.getShareCode()).toBe('X')
      expect(p.getCollectionInfo()).toEqual({ code: 'C', cb_id: 99 })
      expect(p.getOwnerUserId()).toBe(8)
    })

    it('未配置可选字段时返回 undefined', () => {
      const p = new DwebBookmarkProvider({})
      expect(p.getShareCode()).toBeUndefined()
      expect(p.getCollectionInfo()).toBeUndefined()
      expect(p.getOwnerUserId()).toBeUndefined()
    })
  })

  describe('DwebToastService', () => {
    it('showToast：success → Toast.Success', () => {
      const svc = new DwebToastService()
      svc.showToast({ text: 'ok', type: ToastType.Success })
      expect(mockToastShowToast).toHaveBeenCalled()
    })

    it('showToast：error → Toast.Error', () => {
      const svc = new DwebToastService()
      svc.showToast({ text: 'no', type: ToastType.Error })
      expect(mockToastShowToast).toHaveBeenCalled()
    })

    it('showToast：warning → Toast.Normal', () => {
      const svc = new DwebToastService()
      svc.showToast({ text: 'w', type: ToastType.Warning })
      expect(mockToastShowToast).toHaveBeenCalled()
    })

    it('showToast：info → Toast.Normal', () => {
      const svc = new DwebToastService()
      svc.showToast({ text: 'i', type: ToastType.Info })
      expect(mockToastShowToast).toHaveBeenCalled()
    })

    it('showToast：无 type → 不传 localType', () => {
      const svc = new DwebToastService()
      svc.showToast({ text: 'plain' })
      expect(mockToastShowToast).toHaveBeenCalledWith({ text: 'plain', type: undefined })
    })

    it('showCursorToast：转发 CursorToast.showToast', () => {
      const svc = new DwebToastService()
      const dom = document.createElement('div')
      svc.showCursorToast({ text: 'c', trackDom: dom })
      expect(mockCursorToastShowToast).toHaveBeenCalledWith({ text: 'c', trackDom: dom })
    })
  })

  describe('DwebUserProvider', () => {
    it('getUserId：userInfo 存在时返回 userId', () => {
      const p = new DwebUserProvider()
      expect(p.getUserId()).toBe(1)
    })

    it('getUserId：userInfo 不存在时返回 null', () => {
      mockUseUserStore.mockReturnValueOnce({ userInfo: null })
      const p = new DwebUserProvider()
      expect(p.getUserId()).toBeNull()
    })

    it('getUserInfo：返回完整 userInfo 投影', () => {
      const p = new DwebUserProvider()
      expect(p.getUserInfo()).toEqual({ userId: 1, name: 'N', email: 'e@x.com', picture: 'p.png' })
    })

    it('getUserInfo：userInfo 不存在时返回 null', () => {
      mockUseUserStore.mockReturnValueOnce({ userInfo: null })
      const p = new DwebUserProvider()
      expect(p.getUserInfo()).toBeNull()
    })
  })

  describe('DwebHttpClient', () => {
    it('get / post / put / delete：分别转发 request().{verb}', async () => {
      const c = new DwebHttpClient()
      await c.get({ url: '/g' })
      await c.post({ url: '/p' })
      await c.put({ url: '/u' })
      await c.delete({ url: '/d' })
      expect(mockGet).toHaveBeenCalledWith({ url: '/g' })
      expect(mockPost).toHaveBeenCalledWith({ url: '/p' })
      expect(mockPut).toHaveBeenCalledWith({ url: '/u' })
      expect(mockDelete).toHaveBeenCalledWith({ url: '/d' })
    })

    it('保留调用方自定义 errorInterceptors', async () => {
      const c = new DwebHttpClient()
      const errorInterceptors = vi.fn()
      await c.post({ url: '/p', errorInterceptors })
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: '/p', errorInterceptors }))
    })

    it('创建标记时关闭全局错误 toast，交给 Selection 层处理', async () => {
      const c = new DwebHttpClient()
      await c.post({ url: RESTMethodPath.ADD_MARK })
      expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ url: RESTMethodPath.ADD_MARK, errorInterceptors: expect.any(Function) }))
    })
  })
})
