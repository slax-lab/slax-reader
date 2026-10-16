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
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test${path}` },
    tabs: { sendMessage, get: vi.fn(async () => tab), create: vi.fn(async () => ({ id: 13 })), update: vi.fn() },
    action: { setPopup: vi.fn(), openPopup: vi.fn() },
    extension: { isAllowedFileSchemeAccess: vi.fn(async () => true) },
    scripting: { executeScript: vi.fn(async () => []) },
    windows: { create: vi.fn(async () => ({ id: 14, tabs: [{ id: 13 }] })), update: vi.fn() },
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
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce()
    expect(browser.windows.create).not.toHaveBeenCalled()
    expect(browser.action.openPopup).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
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
    await BrowserService.markContentScriptReady(tab.id)
    await BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
    expect(sendMessage).toHaveBeenCalledWith(tab.id, { action: MessageTypeAction.ContentScriptReady })
    expect(sendMessage).not.toHaveBeenCalledWith(tab.id, { action: MessageTypeAction.ShowCollectPopup })
  })
})


test('PDF readiness uses the in-page surface and never creates a window', async () => {
  sendMessage.mockImplementation(async (_id, message) => message.action === MessageTypeAction.ContentScriptReady ? { ready: true, kind: 'pdf' } : { ready: true })
  await BrowserService.markContentScriptReady(tab.id)
  await BrowserService.openCollectPopup(tab as any, 'open_collect', auth)
  expect(sendMessage).toHaveBeenLastCalledWith(tab.id, expect.objectContaining({ action: MessageTypeAction.ShowPdfCollectPopup }), { frameId: 0 })
  expect(browser.windows.create).not.toHaveBeenCalled()
  expect(browser.action.openPopup).not.toHaveBeenCalled()
})
