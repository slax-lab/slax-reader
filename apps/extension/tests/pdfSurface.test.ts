import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MessageTypeAction } from '../src/config/message'
import { mountPdfCollectSurface } from '../src/utils/pdfSurface'

vi.mock('@/utils/locale', () => ({ $t: () => 'Save to Slax Reader' }))
let receive: (message: any, sender: any, respond: any) => void
let pair: (event: any) => void
let frames: any[]
let container: any
beforeEach(() => {
  frames = []
  container = { appendChild: vi.fn(frame => { frame.isConnected = true }) }
  vi.stubGlobal('document', { createElement: vi.fn(() => {
    const frame = { style: {}, contentWindow: {}, isConnected: false, remove: vi.fn(), focus: vi.fn() }
    frames.push(frame)
    return frame
  }) })
  vi.stubGlobal('window', { innerWidth: 320, innerHeight: 720,
    addEventListener: vi.fn((_type, callback) => { pair = callback }), removeEventListener: vi.fn() })
  vi.stubGlobal('browser', { runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test${p}`,
    sendMessage: vi.fn(async () => ({ ok: true })), onMessage: {
      addListener: vi.fn(callback => { receive = callback }), removeListener: vi.fn()
    } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const show = (operation = 'operation') => receive({ action: MessageTypeAction.ShowPdfCollectPopup, operation }, { id: 'test' }, vi.fn())

test('one in-page iframe is reused for repeated save actions', () => {
  mountPdfCollectSurface(container)
  show(); show()
  expect(frames).toHaveLength(1)
  expect(container.appendChild).toHaveBeenCalledOnce()
  expect(frames[0].src).toBe('chrome-extension://test/pdf-save.html?operation=operation&surface=inline')
  expect(frames[0].style.position).toBe('fixed')
  expect(frames[0].style.width).toBe('300px')
})

test('a sibling frame cannot pair itself with a copied operation ID', () => {
  mountPdfCollectSurface(container)
  show()
  const event = { isTrusted: true, source: {}, origin: 'chrome-extension://test', data: { type: 'slax-pdf-frame-ready', operation: 'operation', frameId: 2, token: 'pairing-token' } }
  pair(event)
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  pair({ ...event, source: frames[0].contentWindow, origin: 'https://website.example' })
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  pair({ ...event, source: frames[0].contentWindow, isTrusted: false })
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  pair({ ...event, source: frames[0].contentWindow })
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ target: 'pdf-save', method: 'bind', owner: 'source-controller', operation: 'operation', frameId: 2, token: 'pairing-token' })
})

test('source updates only resize or close the matching collection overlay', () => {
  const surface = mountPdfCollectSurface(container)
  show()
  receive({ action: MessageTypeAction.PdfCollectSurfaceUpdate, operation: 'other', method: 'close' }, { id: 'test' }, vi.fn())
  expect(frames[0].remove).not.toHaveBeenCalled()
  receive({ action: MessageTypeAction.PdfCollectSurfaceUpdate, operation: 'operation', method: 'resize', height: 3000 }, { id: 'test' }, vi.fn())
  expect(frames[0].style.height).toBe('704px')
  surface.unmount()
  expect(frames[0].remove).toHaveBeenCalledOnce()
  expect(browser.runtime.onMessage.removeListener).toHaveBeenCalledOnce()
})
