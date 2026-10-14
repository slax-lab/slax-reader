import { MessageTypeAction } from '../src/config/message'

import { BrowserService } from '../src/entrypoints/background/browserService'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

let stored: Record<string, unknown>
const sendMessage = vi.fn()
const auth = { checkLogin: vi.fn().mockResolvedValue(true) }
const tab = { id: 12, url: 'https://www.youtube.com/watch?v=aircAruvnKk' }

beforeEach(async () => {
  stored = {}
  sendMessage.mockReset()
  auth.checkLogin.mockResolvedValue(true)
  vi.stubGlobal('analytics', { track: vi.fn() })
  vi.stubGlobal('browser', {
    tabs: { sendMessage },
    storage: { session: {
      get: vi.fn(async () => stored),
      set: vi.fn(async value => { Object.assign(stored, value) }),
      remove: vi.fn(async key => { delete stored[key] })
    } }
  })
  await BrowserService.resetContentScripts()
  vi.useFakeTimers()
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('collector readiness after SPA navigation / service worker restart', () => {
  test('opens the panel after a live content-script acknowledgement without another ready event', async () => {
    sendMessage.mockImplementation(async (_id, message) => message.action === MessageTypeAction.ContentScriptReady ? { ready: true } : undefined)
    await BrowserService.markContentScriptReady(tab.id)
    await BrowserService.clearContentScript(tab.id)
    await BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
    expect(sendMessage).toHaveBeenLastCalledWith(tab.id, { action: MessageTypeAction.ShowCollectPopup })
  })

  test('an unrelated listener returning undefined is not proof the collector is ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sendMessage.mockResolvedValue(undefined)
    const opening = BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
    await vi.runAllTimersAsync()
    await opening
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[collect] content script not ready', { tabId: tab.id })
  })

  test('a new ready announcement unblocks an in-flight command', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver yet'))
    const opening = BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
    await vi.advanceTimersByTimeAsync(100)
    sendMessage.mockResolvedValue(undefined)
    await BrowserService.markContentScriptReady(tab.id)
    await opening
    expect(sendMessage).toHaveBeenLastCalledWith(tab.id, { action: MessageTypeAction.ShowCollectPopup })
  })

  test('a logged-out session never sends a collect command', async () => {
    auth.checkLogin.mockResolvedValue(false)
    await BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
