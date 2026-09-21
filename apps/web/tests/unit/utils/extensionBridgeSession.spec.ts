// @vitest-environment happy-dom
import { requestExtensionBridgeSession } from '~~/app/utils/extensionBridgeSession'

import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

const clientId = 'abcdefghijklmnopabcdefghijklmnop'
const origin = `chrome-extension://${clientId}`
const options = { clientId, configuredIds: new Set([clientId]), environment: 'production', timeoutMs: 100 }
let parent: { postMessage: ReturnType<typeof vi.fn> }
const getSessionRequest = (index = 0) => {
  const call = parent.postMessage.mock.calls[index]
  assert.isDefined(call, 'The bridge must request a session before receiving a reply')
  return call[0]
}
const reply = (requestId: string, overrides: Record<string, unknown> = {}, source: unknown = parent, from = origin) => {
  window.dispatchEvent(new MessageEvent('message', {
    source: source as Window,
    origin: from,
    data: { type: 'slax-bridge-session-response', requestId, success: true, token: 'session-token', ...overrides }
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/x/ext-bridge')
  parent = { postMessage: vi.fn() }
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('extension bridge session transport', () => {
  it('gets a fresh session without cookies, URL tokens or persistent storage', async () => {
    const first = requestExtensionBridgeSession(options)
    const request = getSessionRequest()
    expect(parent.postMessage).toHaveBeenCalledWith(request, '*')
    expect(request).toEqual({ type: 'slax-bridge-session-request', requestId: expect.any(String) })
    reply(request.requestId)
    await expect(first).resolves.toBe('session-token')

    const second = requestExtensionBridgeSession(options)
    const nextRequest = getSessionRequest(1)
    reply(nextRequest.requestId, { token: 'renewed-token' })
    await expect(second).resolves.toBe('renewed-token')
    expect(window.location.hash).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a wrong source, origin or request ID', async () => {
    const settled = vi.fn()
    const result = requestExtensionBridgeSession(options).then(settled)
    const { requestId } = getSessionRequest()
    reply(requestId, {}, window)
    reply(requestId, {}, parent, 'https://attacker.test')
    reply('other-request')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    reply(requestId, { token: null })
    await result
    expect(settled).toHaveBeenCalledWith(null)
  })

  it('rejects unconfigured clients before requesting credentials', async () => {
    await expect(requestExtensionBridgeSession({ ...options, configuredIds: new Set() })).rejects.toThrow('not allowed')
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it('rejects a failed response and removes its listener', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const result = requestExtensionBridgeSession(options)
    const assertion = expect(result).rejects.toThrow('unavailable')
    reply(getSessionRequest().requestId, { success: false })
    await assertion
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out without retaining a late response', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const result = requestExtensionBridgeSession(options)
    const assertion = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cannot request a session from an ordinary dweb page', async () => {
    window.history.replaceState(null, '', '/bookmarks')
    await expect(requestExtensionBridgeSession(options)).rejects.toThrow('requires an extension bridge frame')
    expect(parent.postMessage).not.toHaveBeenCalled()
  })
})
