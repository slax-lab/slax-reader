import { vi } from 'vitest'

// dweb 业务代码主要走 nuxt auto-import 调用 request() / getUserToken() / haveRequestToken()
// （没有显式 import 语句），少数文件（如 components/Article/Selection/adapters/DwebHttpClient.ts）
// 走显式 import 路径 `~/utils/request`。两套路径需要不同的 mock 策略。
//
// 本文件提供：
//   1. vi.mock('~/...' / '~~/...') 兜底 —— 让任何**显式 import** request 的代码
//      自动拿到下面 vi.hoisted 里造的 mock 实例
//   2. 共享的方法名 reference 与本文件的 spy 句柄（仅"显式 import 路径"测试可消费）
//
// 方法名以 packages/frontend-utils/src/request.ts 的 FetchRequest 为准：
//   - 标准动词：get / post / put / delete（注意是 delete，不是 del）
//   - 流式与文件：stream / upgrade / uploadFile

// vi.hoisted 让所有 spies 在 vi.mock factory 求值时已就绪
export const requestMockHandles = vi.hoisted(() => {
  const post = vi.fn()
  const get = vi.fn()
  const put = vi.fn()
  const del = vi.fn() // 局部变量名 del，导出时仍叫 mockDelete
  const stream = vi.fn()
  const upgrade = vi.fn()
  const uploadFile = vi.fn()

  return {
    mockPost: post,
    mockGet: get,
    mockPut: put,
    mockDelete: del,
    mockStream: stream,
    mockUpgrade: upgrade,
    mockUploadFile: uploadFile,
    mockGetUserToken: vi.fn(() => 'test-token'),
    mockHaveRequestToken: vi.fn(() => true),
    mockRequest: vi.fn(() => ({
      post,
      get,
      put,
      delete: del,
      stream,
      upgrade,
      uploadFile
    }))
  }
})

// 解构对外导出，保持原有命名
export const { mockPost, mockGet, mockPut, mockDelete, mockStream, mockUpgrade, mockUploadFile, mockGetUserToken, mockHaveRequestToken, mockRequest } = requestMockHandles

// 兜底：拦截显式 import 路径（例如 DwebHttpClient.ts）
// 注意：vi.mock factory 被 hoist 到文件顶部，此时解构的 const（mockRequest 等）还在 TDZ，
// 必须通过 requestMockHandles.xxx 访问（vi.hoisted 结果在 vi.mock 运行前已就绪）。
vi.mock('~/utils/request', () => ({
  request: requestMockHandles.mockRequest,
  getUserToken: requestMockHandles.mockGetUserToken,
  haveRequestToken: requestMockHandles.mockHaveRequestToken
}))
vi.mock('~~/app/utils/request', () => ({
  request: requestMockHandles.mockRequest,
  getUserToken: requestMockHandles.mockGetUserToken,
  haveRequestToken: requestMockHandles.mockHaveRequestToken
}))

// 两套用法（按被测代码的 import 形式选）：
//
// A. 被测代码**显式 import** request（走 vi.mock 路径）：
//
//      // 被测：components/Article/Selection/adapters/DwebHttpClient.ts
//      // 它写：import { request } from '~/utils/request'
//
//      import { mockPost } from '~~/tests/mocks/request'
//
//      beforeEach(() => mockPost.mockReset())
//      mockPost.mockResolvedValueOnce({ data: ... })
//
//   本文件下面的两行 vi.mock 已经把 ~/ / ~~ 两套路径都拦住，spec 直接 import
//   句柄即可控制返回值。
//
// B. 被测代码走 **nuxt auto-import**（走 mockNuxtImport 宏）：
//
//      // 被测：app/composables/useAuth.ts —— 直接调 request() 没有 import
//
//      import { vi } from 'vitest'
//
//      // 必须在 spec 自己文件里 vi.hoisted —— mockNuxtImport 被 transform 后 hoist 到顶部，
//      // 它的 factory 拿不到跨文件 import 的 binding（仍在 TDZ）。
//      const { mockRequest, mockPost } = vi.hoisted(() => {
//        const post = vi.fn()
//        return {
//          mockPost: post,
//          mockRequest: vi.fn(() => ({ post, get: vi.fn(), put: vi.fn(), delete: vi.fn() }))
//        }
//      })
//      mockNuxtImport('request', () => mockRequest)
//
//   参考实现：tests/unit/composables/useAuth.spec.ts。本文件的 mockRequest / mockPost
//   等导出**对 auto-import 场景无效**，请勿与上面用法混用。
