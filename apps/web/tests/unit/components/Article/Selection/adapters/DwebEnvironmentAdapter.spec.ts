// DwebEnvironmentAdapter 测试套件 —— Sprint 3
// 覆盖 getWindow / getDocument / getSelection 三个方法（6 用例）
// class 无外部依赖，纯 happy-dom 环境。
// getSelection 用例用 vi.spyOn 拦截，afterEach vi.restoreAllMocks() 还原——
// vitest config 未设 restoreMocks: true，spy 不会自动恢复，必须手动还原。
import { DwebEnvironmentAdapter } from '~~/app/components/Article/Selection/adapters/DwebEnvironmentAdapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

// spy 不会自动恢复，必须在每个用例后手动还原，防止泄漏到后续用例
afterEach(() => {
  vi.restoreAllMocks()
})

describe('DwebEnvironmentAdapter', () => {
  describe('无 iframe 构造', () => {
    it('getWindow() 返回全局 window', () => {
      const adapter = new DwebEnvironmentAdapter()
      expect(adapter.getWindow()).toBe(window)
    })

    it('getDocument() 返回全局 document', () => {
      const adapter = new DwebEnvironmentAdapter()
      expect(adapter.getDocument()).toBe(document)
    })

    it('getSelection() 调用全局 window.getSelection 并返回结果', () => {
      const mockSelection = {} as Selection
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection)
      const adapter = new DwebEnvironmentAdapter()
      const result = adapter.getSelection()
      expect(window.getSelection).toHaveBeenCalledTimes(1)
      expect(result).toBe(mockSelection)
    })
  })

  describe('传入 iframe 构造', () => {
    it('getWindow() 返回 iframe.contentWindow', () => {
      const iframe = document.createElement('iframe')
      document.body.appendChild(iframe)
      const adapter = new DwebEnvironmentAdapter(iframe)
      expect(adapter.getWindow()).toBe(iframe.contentWindow)
      document.body.removeChild(iframe)
    })

    it('getDocument() 返回 iframe.contentDocument', () => {
      const iframe = document.createElement('iframe')
      document.body.appendChild(iframe)
      const adapter = new DwebEnvironmentAdapter(iframe)
      expect(adapter.getDocument()).toBe(iframe.contentDocument)
      document.body.removeChild(iframe)
    })

    it('getSelection() 调用 iframe.contentWindow.getSelection 并返回结果', () => {
      const iframe = document.createElement('iframe')
      document.body.appendChild(iframe)
      const mockSelection = {} as Selection
      vi.spyOn(iframe.contentWindow!, 'getSelection').mockReturnValue(mockSelection)
      const adapter = new DwebEnvironmentAdapter(iframe)
      const result = adapter.getSelection()
      expect(iframe.contentWindow!.getSelection).toHaveBeenCalledTimes(1)
      expect(result).toBe(mockSelection)
      document.body.removeChild(iframe)
    })
  })
})
