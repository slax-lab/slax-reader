import { MessageTypeAction } from '../src/config/message'

import { BrowserService } from '../src/entrypoints/background/browserService'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const content = { matches: ['<all_urls>'], js: ['content-scripts/content.js'] }
const mark = { matches: ['<all_urls>'], css: ['content-scripts/mark.css'] }
let entries: Array<{ matches: string[]; js?: string[]; css?: string[] }>
let stored: Record<string, unknown>
const query = vi.fn()
const sendMessage = vi.fn()
const insertCSS = vi.fn()
const executeScript = vi.fn()
const tab = { id: 12, url: 'https://example.org/article' }

beforeEach(async () => {
  vi.resetAllMocks()
  stored = {}
  entries = [content, mark]
  query.mockResolvedValue([tab])
  sendMessage.mockRejectedValue(new Error('No receiver'))
  insertCSS.mockResolvedValue(undefined)
  executeScript.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('browser', {
    runtime: { getManifest: () => ({ content_scripts: entries }) },
    tabs: { query, sendMessage, reload: vi.fn(), update: vi.fn(), create: vi.fn() },
    scripting: { insertCSS, executeScript },
    storage: { session: {
      get: vi.fn(async () => stored),
      set: vi.fn(async value => { Object.assign(stored, value) }),
      remove: vi.fn(async key => { delete stored[key] })
    } }
  })
  await BrowserService.resetContentScripts()
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('first-install activation', () => {
  test('injects page CSS before the collector in the top frame without a save or navigation', async () => {
    await BrowserService.activateContentScripts()
    expect(query).toHaveBeenCalledWith({ url: ['http://*/*', 'https://*/*'] })
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(tab.id, { action: MessageTypeAction.ContentScriptReady }, { frameId: 0 })
    expect(insertCSS).toHaveBeenCalledExactlyOnceWith({ target: { tabId: tab.id, frameIds: [0] }, files: ['content-scripts/mark.css'] })
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: tab.id, frameIds: [0] }, files: ['content-scripts/content.js'] })
    expect(insertCSS.mock.invocationCallOrder[0]).toBeLessThan(executeScript.mock.invocationCallOrder[0])
    expect(browser.tabs.reload).not.toHaveBeenCalled()
    expect(browser.tabs.update).not.toHaveBeenCalled()
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(stored['content-script-ready-tabs']).toBeUndefined()
  })

  test('loads declared vendor prerequisites first and leaves unrelated resources alone', async () => {
    entries = [
      { matches: ['<all_urls>'], js: ['vendor.js'] },
      content, mark,
      { matches: ['https://reader.test/*'], js: ['bridge.js'], css: ['bridge.css'] },
      { matches: ['<all_urls>'], css: ['content-scripts/content.css'] }
    ]
    await BrowserService.activateContentScripts()
    expect(executeScript.mock.calls[0][0].files).toEqual(['vendor.js', 'content-scripts/content.js'])
    expect(insertCSS.mock.calls[0][0].files).toEqual(['content-scripts/mark.css'])
  })

  test('reuses an explicitly ready collector and restores readiness bookkeeping', async () => {
    sendMessage.mockResolvedValue({ ready: true, kind: 'html' })
    await BrowserService.activateContentScripts()
    expect(executeScript).not.toHaveBeenCalled()
    expect(insertCSS).not.toHaveBeenCalled()
    expect(stored['content-script-ready-tabs']).toEqual([tab.id])
  })

  test.each([undefined, {}, { ready: false }])('does not treat %j as a ready collector', async response => {
    sendMessage.mockResolvedValue(response)
    await BrowserService.activateContentScripts()
    expect(executeScript).toHaveBeenCalledOnce()
  })

  test('uses a live probe even when readiness was cached', async () => {
    await BrowserService.markContentScriptReady(tab.id)
    await BrowserService.activateContentScripts()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(executeScript).toHaveBeenCalledOnce()
  })

  test('skips missing IDs, URLs and non-HTTP schemes without requesting permissions', async () => {
    query.mockResolvedValue([
      { url: tab.url }, { id: 1 },
      ...['chrome://settings', 'edge://extensions', 'about:blank', 'chrome-extension://other/page.html', 'devtools://devtools', 'file:///article.pdf', 'data:text/html,test', 'blob:https://example.org/id'].map((url, i) => ({ id: i + 2, url })),
      { id: 0, url: 'http://example.org/zero' }, tab
    ])
    await BrowserService.activateContentScripts()
    expect(executeScript.mock.calls.map(([call]) => call.target.tabId)).toEqual([0, tab.id])
  })

  test.each(['css', 'script'])('contains a denied or closed tab during %s injection', async stage => {
    query.mockResolvedValue([{ id: 1, url: 'https://restricted.test/' }, tab])
    const mock = stage === 'css' ? insertCSS : executeScript
    mock.mockImplementation(async ({ target }) => { if (target.tabId === 1) throw new Error('Private URL must not be logged') })
    await expect(BrowserService.activateContentScripts()).resolves.toBeUndefined()
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: tab.id, frameIds: [0] }, files: ['content-scripts/content.js'] })
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('[install] collector activation unavailable for tab', 1)
  })

  test('lets the install handler contain a failed tab query', async () => {
    query.mockRejectedValue(new Error('Query failed'))
    await expect(BrowserService.activateContentScripts()).rejects.toThrow('Query failed')
    expect(executeScript).not.toHaveBeenCalled()
  })

  test('does not execute a partial bundle when the collector manifest entry is absent', async () => {
    entries = [mark]
    await BrowserService.activateContentScripts()
    expect(insertCSS).not.toHaveBeenCalled()
    expect(executeScript).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('[install] collector activation unavailable for tab', tab.id)
  })
})
