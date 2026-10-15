import { MessageTypeAction } from '@/config/message'

export const PDF_OPERATIONS_KEY = 'pdf-save-operations'
export const PDF_OPERATION_TTL = 15 * 60 * 1000
export type PdfOperation = {
  id: string
  sourceTabId: number
  sourceUrl: string
  surface: 'inline' | 'action'
  pageFrameId?: number
  bindingFrameId?: number
  bindingToken?: string
  expires: number
  invalid?: boolean
  owner?: string
  state: 'ready' | 'busy' | 'submitted' | 'saved' | 'queued'
}

function exactPdfDocument(sender: Browser.runtime.MessageSender, operation?: PdfOperation): boolean {
  try {
    const actual = new URL(sender.url || '')
    const expected = new URL(browser.runtime.getURL('/pdf-save.html'))
    return sender.id === browser.runtime.id && actual.protocol === expected.protocol && actual.host === expected.host &&
      actual.pathname === expected.pathname && (operation ? actual.searchParams.get('operation') === operation.id ||
        operation.surface === 'action' && !actual.search : !actual.search)
  } catch { return false }
}
export function trustedPdfAction(sender: Browser.runtime.MessageSender): boolean {
  return exactPdfDocument(sender) && !sender.tab && (sender.frameId == null || sender.frameId === 0)
}
export function trustedPdfPage(sender: Browser.runtime.MessageSender, operation: PdfOperation): boolean {
  if (!exactPdfDocument(sender, operation)) return false
  return operation.surface === 'action' ? !sender.tab && (sender.frameId == null || sender.frameId === 0) :
    sender.tab?.id === operation.sourceTabId && sender.frameId === operation.pageFrameId && operation.pageFrameId != null
}

let transition: Promise<unknown> = Promise.resolve()
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const next = transition.then(action, action)
  transition = next.catch(() => {})
  return next
}
async function read(): Promise<PdfOperation[]> {
  const stored = (await browser.storage.session.get(PDF_OPERATIONS_KEY))[PDF_OPERATIONS_KEY]
  const operations = (Array.isArray(stored) ? stored : []).filter((item: PdfOperation) => item.expires > Date.now()).slice(-20)
  await write(operations)
  return operations
}
async function write(operations: PdfOperation[]) {
  await browser.storage.session.set({ [PDF_OPERATIONS_KEY]: operations.slice(-20) })
}
async function prepare(tab: Browser.tabs.Tab, surface: PdfOperation['surface']): Promise<PdfOperation | undefined> {
  if (tab.id == null) return
  const current = await browser.tabs.get(tab.id)
  if (current.url !== tab.url) return
  const operations = await read()
  const existing = operations.find(item => !item.invalid && item.sourceTabId === tab.id && item.sourceUrl === tab.url && item.surface === surface)
  if (existing) return existing
  const operation: PdfOperation = {
    id: crypto.randomUUID(), sourceTabId: tab.id, sourceUrl: tab.url || '', surface,
    expires: Date.now() + PDF_OPERATION_TTL, state: 'ready'
  }
  await write([...operations.filter(item => item.sourceTabId !== tab.id || item.sourceUrl !== tab.url), operation])
  return operation
}
export function openPdfSave(tab: Browser.tabs.Tab): Promise<void> {
  return serialized(async () => {
    const operation = await prepare(tab, 'inline')
    if (!operation) return
    await browser.tabs.sendMessage(operation.sourceTabId, { action: MessageTypeAction.ShowPdfCollectPopup, operation: operation.id }, { frameId: 0 })
  })
}
export function initializePdfAction(tab: Browser.tabs.Tab): Promise<Record<string, unknown>> {
  return serialized(async () => {
    const operation = await prepare(tab, 'action')
    return operation ? { ok: true, operation: operation.id } : { error: 'source' }
  })
}
export async function configurePdfAction(tab: Browser.tabs.Tab): Promise<void> {
  if (tab.id == null) return
  const needsGuide = tab.url?.startsWith('file:') && !(await browser.extension.isAllowedFileSchemeAccess())
  await browser.action.setPopup({ tabId: tab.id, popup: needsGuide ? browser.runtime.getURL('/pdf-save.html') : '' })
}
export async function openPdfAction(tab: Browser.tabs.Tab): Promise<void> {
  const operation = await serialized(() => prepare(tab, 'action'))
  if (!operation) return
  await browser.action.setPopup({ tabId: operation.sourceTabId, popup: browser.runtime.getURL('/pdf-save.html') + '?operation=' + operation.id })
  // Normal file-permission guidance is configured before the click. This is also
  // a best-effort recovery for a click that races tab/permission initialization.
  const action = browser.action as typeof browser.action & { openPopup?: (options?: { windowId?: number }) => Promise<void> }
  if (action.openPopup) await action.openPopup(tab.windowId == null ? undefined : { windowId: tab.windowId })
}
export function invalidatePdfSource(tabId: number, removed = false): Promise<void> {
  return serialized(async () => {
    const operations = await read()
    await write(operations.filter(item => !removed || item.sourceTabId !== tabId).map(item =>
      item.sourceTabId === tabId ? { ...item, invalid: true } : item))
  })
}
export function pdfOperationMessage(message: Record<string, unknown>, sender: Browser.runtime.MessageSender): Promise<Record<string, unknown>> {
  return serialized(async () => {
    if (!['identify', 'bind', 'bound', 'claim', 'check', 'begin', 'submit', 'release', 'complete', 'retry', 'resize', 'close'].includes(String(message.method)) ||
      typeof message.operation !== 'string' || typeof message.owner !== 'string' || !message.owner || message.owner.length > 100 ||
      Object.keys(message).some(key => !['target', 'method', 'owner', 'operation', 'result', 'frameId', 'token', 'height'].includes(key)) ||
      (message.method === 'complete' && !['saved', 'queued'].includes(String(message.result)))) return { error: 'source' }
    const operations = await read()
    const operation = operations.find(item => item.id === message.operation)
    if (!operation) return { error: 'source' }
    if (message.method === 'bind') {
      const source = await browser.tabs.get(operation.sourceTabId).catch(() => null)
      if (operation.invalid || source?.url !== operation.sourceUrl || sender.id !== browser.runtime.id || sender.frameId !== 0 ||
        sender.tab?.id !== operation.sourceTabId || sender.url !== operation.sourceUrl || operation.surface !== 'inline' ||
        message.frameId !== operation.bindingFrameId || message.token !== operation.bindingToken || !operation.bindingToken) return { error: 'source' }
      operation.pageFrameId = operation.bindingFrameId
      delete operation.bindingFrameId
      delete operation.bindingToken
      await write(operations)
      return { ok: true }
    }
    if (message.method === 'identify') {
      const source = await browser.tabs.get(operation.sourceTabId).catch(() => null)
      if (operation.invalid || source?.url !== operation.sourceUrl || operation.surface !== 'inline' || !exactPdfDocument(sender, operation) ||
        sender.tab?.id !== operation.sourceTabId || sender.frameId == null || sender.frameId <= 0) return { error: 'source' }
      if (operation.pageFrameId === sender.frameId) return { ok: true, bound: true }
      operation.bindingFrameId = sender.frameId
      operation.bindingToken = crypto.randomUUID()
      await write(operations)
      return { ok: true, bound: false, frameId: sender.frameId, token: operation.bindingToken }
    }
    if (!trustedPdfPage(sender, operation)) return { error: message.method === 'bound' ? 'pending' : 'source' }
    if (message.method === 'bound') return { ok: true }
    if (message.method === 'complete') {
      if (operation.owner !== message.owner || operation.state !== 'submitted') return { error: 'source' }
      operation.state = message.result === 'saved' ? 'saved' : 'queued'
      await write(operations)
      return { ok: true }
    }
    if (message.method === 'resize' || message.method === 'close') {
      if (operation.owner !== message.owner) return { error: 'source' }
      if (message.method === 'resize' && (typeof message.height !== 'number' || !Number.isFinite(message.height))) return { error: 'source' }
      if (operation.surface === 'inline') await browser.tabs.sendMessage(operation.sourceTabId, {
        action: MessageTypeAction.PdfCollectSurfaceUpdate, operation: operation.id, method: message.method,
        ...(message.method === 'resize' ? { height: Math.max(80, Math.min(1200, Number(message.height))) } : {})
      }, { frameId: 0 }).catch(() => {})
      if (message.method === 'close') await write(operations.filter(item => item !== operation))
      return { ok: true }
    }
    const source = await browser.tabs.get(operation.sourceTabId).catch(() => null)
    if (operation.invalid || source?.url !== operation.sourceUrl) return { error: 'source' }
    const autoStart = message.method === 'claim' && !operation.owner && operation.state === 'ready'
    if (message.method === 'claim') {
      if (operation.owner !== message.owner) {
        operation.owner = message.owner
        if (operation.state === 'busy') operation.state = 'ready'
      }
    } else if (operation.owner !== message.owner) return { error: 'source' }
    if (message.method === 'retry' && operation.state === 'submitted') operation.state = 'ready'
    if (message.method === 'begin') {
      if (operation.state !== 'ready') return { error: 'busy' }
      operation.state = 'busy'
    }
    if (message.method === 'submit') {
      if (operation.state !== 'busy') return { error: 'busy' }
      operation.state = 'submitted'
    }
    if (message.method === 'release' && operation.state === 'busy') operation.state = 'ready'
    await write(operations)
    return { ok: true, sourceUrl: operation.sourceUrl, state: operation.state, autoStart, surface: operation.surface }
  })
}
