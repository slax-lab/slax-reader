import { describe, test, expect, vi } from 'vitest'
import { withTimeout, deriveScreenshotKey } from '@/utils/async'

describe('withTimeout', () => {
  test('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000)
    expect(result).toBe('ok')
  })

  test('rejects when promise exceeds timeout', async () => {
    vi.useFakeTimers()
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    const p = withTimeout(slow, 100)
    vi.advanceTimersByTime(100)
    await expect(p).rejects.toThrow('Operation timed out')
    vi.useRealTimers()
  })

  test('uses custom timeout message', async () => {
    vi.useFakeTimers()
    const slow = new Promise(resolve => setTimeout(resolve, 5000))
    const p = withTimeout(slow, 50, 'Custom timeout')
    vi.advanceTimersByTime(50)
    await expect(p).rejects.toThrow('Custom timeout')
    vi.useRealTimers()
  })

  test('propagates promise rejection', async () => {
    const failing = Promise.reject(new Error('boom'))
    await expect(withTimeout(failing, 1000)).rejects.toThrow('boom')
  })

  test('clears timer after promise resolves', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await withTimeout(Promise.resolve(42), 5000)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})

describe('deriveScreenshotKey', () => {
  test('converts html content key to screenshot key', () => {
    expect(deriveScreenshotKey('html/parse/workflow_123_456.html')).toBe('screenshot/workflow_123_456.jpg')
  })

  test('handles different bookmark IDs', () => {
    expect(deriveScreenshotKey('html/parse/workflow_999_1000.html')).toBe('screenshot/workflow_999_1000.jpg')
  })

  test('only replaces the expected path prefix and extension', () => {
    expect(deriveScreenshotKey('html/parse/test.html')).toBe('screenshot/test.jpg')
  })

  test('does not modify keys without the expected prefix', () => {
    expect(deriveScreenshotKey('other/path/file.html')).toBe('other/path/file.jpg')
  })
})
