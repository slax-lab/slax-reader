// utils/analytics.ts 测试套件
// fork 版本用首方 /events 接口（eventLog）替代 upstream 的 firebaseAnalyticsLog（Firebase Analytics），
// 后者在 fork 里已不存在，故本文件只保留跨 upstream/fork 都通用的 analyticsLog（GTM dataLayer）测试。
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dataLayerPushMock, useScriptGoogleTagManagerMock } = vi.hoisted(() => {
  const dataLayerPushMock = vi.fn()
  return {
    dataLayerPushMock,
    useScriptGoogleTagManagerMock: vi.fn(() => ({ proxy: { dataLayer: { push: dataLayerPushMock } } }))
  }
})

// 顶层可变 runtimeConfig：用例内翻转 appVersion，beforeEach 还原默认值。
// 必须保留 app.baseURL —— nuxt-test-utils router plugin 在 setupNuxt 期读取，缺失会报 NUXT_E1005。
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    appVersion: '1.0.0' as string | undefined
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)
mockNuxtImport('useScriptGoogleTagManager', () => useScriptGoogleTagManagerMock)

let analyticsModule: typeof import('~~/app/utils/analytics')

beforeEach(async () => {
  dataLayerPushMock.mockReset()
  useScriptGoogleTagManagerMock.mockReset().mockReturnValue({ proxy: { dataLayer: { push: dataLayerPushMock } } })
  runtimeConfig.public.appVersion = '1.0.0'
  analyticsModule = await import('~~/app/utils/analytics')
})

describe('analyticsLog', () => {
  it('正常路径 → dataLayer.push 收到 { event, platform, version, ...rest }', () => {
    analyticsModule.analyticsLog({ event: 'bookmark_view', id: 'a1', mode: 'original' })
    expect(dataLayerPushMock).toHaveBeenCalledTimes(1)
    expect(dataLayerPushMock).toHaveBeenCalledWith({
      event: 'bookmark_view',
      id: 'a1',
      mode: 'original',
      platform: 'web',
      version: '1.0.0'
    })
  })

  it("config.public.appVersion 缺失 → version fallback 'unknown'", () => {
    runtimeConfig.public.appVersion = undefined
    analyticsModule.analyticsLog({ event: 'bookmark_view', id: 'a2', mode: 'snapshot' })
    expect(dataLayerPushMock).toHaveBeenCalledTimes(1)
    expect(dataLayerPushMock.mock.calls[0]?.[0]).toMatchObject({ version: 'unknown' })
  })

  it('useScriptGoogleTagManager 抛错 → console.error 被调，不向上抛', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useScriptGoogleTagManagerMock.mockImplementationOnce(() => {
      throw new Error('GTM unavailable')
    })
    expect(() => analyticsModule.analyticsLog({ event: 'bookmark_view', id: 'a3', mode: 'original' })).not.toThrow()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.[0]).toBe('[Analytics] Track error:')
    expect(dataLayerPushMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
