// pages/bookmarks/[id].vue middleware 单测
// fork 版本此页是纯跳转壳（详情页逻辑已迁移到 /b/[id]），middleware 按后端返回的
// bookmark_user_uuid / type=shortcut 决定跳转目标，无渲染逻辑可测，故只测 middleware 三分支。
// definePageMeta 在组件挂载（setup 执行）时才会调用，故用 mountWithApp 走完整 Nuxt 生命周期
// 后再取捕获到的 middleware 函数直接调用，不手动裸 import + resetModules（会打断
// @nuxt/test-utils 的 setupNuxt 初始化，报 NUXT_E1005）。
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockNavigateTo, capturedMeta } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockNavigateTo: vi.fn((arg: unknown, opts?: unknown) => ({ navigated: true, arg, opts })),
  capturedMeta: { value: undefined as { middleware?: Array<(to: unknown) => unknown> } | undefined }
}))

mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('definePageMeta', () => (meta: { middleware?: Array<(to: unknown) => unknown> }) => {
  capturedMeta.value = meta
})
mockNuxtImport('request', () => () => ({ get: mockGet }))

const makeTo = (query: Record<string, string> = {}) => ({ params: { id: '1000001' }, query })

describe('pages/bookmarks/[id].vue middleware', () => {
  beforeEach(async () => {
    mockGet.mockReset()
    mockNavigateTo.mockClear()
    capturedMeta.value = undefined
    const BookmarkIdPage = (await import('~~/app/pages/bookmarks/[id].vue')).default
    mountWithApp(BookmarkIdPage)
  })

  const runMiddleware = (to: ReturnType<typeof makeTo>) => {
    const middleware = capturedMeta.value?.middleware?.[0]
    if (!middleware) throw new Error('middleware 未捕获到，definePageMeta mock 未生效')
    return middleware(to)
  }

  it('detail.type="shortcut" + target_url → 外链 replace 跳转到 target_url', async () => {
    mockGet.mockResolvedValue({ type: 'shortcut', target_url: 'https://example.com/original' })
    await runMiddleware(makeTo())
    expect(mockNavigateTo).toHaveBeenCalledWith('https://example.com/original', { replace: true, external: true })
  })

  it('detail.bookmark_user_uuid 存在 → 跳转 /b/{uuid}，透传 query（如 highlight）', async () => {
    mockGet.mockResolvedValue({ bookmark_user_uuid: 'uuid-abc' })
    await runMiddleware(makeTo({ highlight: '5' }))
    expect(mockNavigateTo).toHaveBeenCalledWith('/b/uuid-abc?highlight=5', { external: true, replace: true })
  })

  it('detail 请求失败/无标识 → 兜底跳转 /bookmarks', async () => {
    mockGet.mockRejectedValue(new Error('not found'))
    await runMiddleware(makeTo())
    expect(mockNavigateTo).toHaveBeenCalledWith('/bookmarks', { replace: true })
  })
})
