import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  badge: vi.fn(),
  menus: vi.fn(async () => {}),
  openTab: vi.fn(),
  hasSession: vi.fn(async () => false),
  status: vi.fn(async () => ({ ok: false })),
  alarm: vi.fn(async () => {})
}))
vi.mock('../src/entrypoints/background/browserService', () => ({ BrowserService: {
  activateContentScripts: mocks.activate, resetContentScripts: mocks.reset,
  setupBadge: mocks.badge, registerContextMenus: mocks.menus, openTab: mocks.openTab,
  watchPinnedStatusChanges: vi.fn(), setToolbarNotificationDot: vi.fn()
} }))
vi.mock('../src/entrypoints/background/localeAlarm', () => ({ ensureLocaleCalibrationAlarm: mocks.alarm }))
vi.mock('../src/entrypoints/background/localeService', () => ({ LocaleService: class {
  initialize = async () => {}
  refresh = async () => {}
  invalidateSession = async () => {}
} }))
vi.mock('../src/entrypoints/background/sessionService', () => ({
  SessionService: class { getToken = async () => null; hasSession = mocks.hasSession; clearSession = async () => true },
  getTokenIdentityKeys: () => new Set(), getSessionAccountKey: async () => null, userInfoMatchesIdentity: () => false
}))
vi.mock('../src/entrypoints/background/bridgeService', () => ({
  BridgeService: class { status = mocks.status; teardown = async () => {} }, canUseBridgeState: () => false
}))
vi.mock('../src/entrypoints/background/storageService', () => ({ StorageService: class { clearUserData = async () => {} } }))
vi.mock('../src/entrypoints/background/metricService', () => ({ MetricService: class {} }))
vi.mock('../src/entrypoints/background/messageHandler', () => ({ MessageHandler: class {} }))

const event = () => ({ addListener: vi.fn() })
let installed: ReturnType<typeof event>
let toolbar: ReturnType<typeof event>
let messages: ReturnType<typeof event>
const setPopup = vi.fn(async () => {})
const createTab = vi.fn(async () => {})
const updateTab = vi.fn(async () => {})
const queryTabs = vi.fn(async (): Promise<{ id: number; url: string }[]> => [])

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.activate.mockResolvedValue(undefined)
  mocks.reset.mockResolvedValue(undefined)
  mocks.hasSession.mockResolvedValue(false)
  mocks.status.mockResolvedValue({ ok: false })
  installed = event()
  toolbar = event()
  messages = event()
  queryTabs.mockResolvedValue([])
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubGlobal('analytics', { setEnabled: vi.fn() })
  vi.stubGlobal('defineBackground', (fn: () => void) => ({ main: fn }))
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    cookies: { onChanged: event() }, alarms: { onAlarm: event() },
    webRequest: { onCompleted: event() },
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test${path}`, onConnect: event(), onInstalled: installed, onMessage: messages, setUninstallURL: vi.fn() },
    tabs: { query: queryTabs, create: createTab, update: updateTab, onUpdated: event(), onRemoved: event(), onActivated: event() },
    action: { onClicked: toolbar, setPopup }, contextMenus: { onClicked: event() }, commands: { onCommand: event() }
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { default: start } = await import('../src/entrypoints/background/index')
  start.main()
  await Promise.resolve()
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

const install = (reason: string) => installed.addListener.mock.calls[0][0]({ reason })

test('first install activates only after readiness reset and preserves logged-out onboarding', async () => {
  let resolveReset!: () => void
  mocks.reset.mockImplementationOnce(() => new Promise(resolve => { resolveReset = resolve }))
  const pending = install('install')
  expect(mocks.activate).not.toHaveBeenCalled()
  resolveReset()
  await pending
  expect(mocks.activate).toHaveBeenCalledOnce()
  expect(mocks.badge).toHaveBeenCalledOnce()
  expect(mocks.menus).toHaveBeenCalledOnce()
  expect(mocks.alarm).toHaveBeenCalled()
  expect(mocks.openTab).toHaveBeenCalledWith('https://reader.test/guide?from=extension')
  expect(analytics.setEnabled).toHaveBeenCalledWith(true)
})

test.each(['update', 'chrome_update', 'shared_module_update'])('%s does not activate existing tabs', async reason => {
  await install(reason)
  expect(mocks.reset).toHaveBeenCalledOnce()
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(mocks.menus).toHaveBeenCalledOnce()
  expect(mocks.openTab).not.toHaveBeenCalled()
})

test('worker startup alone never activates existing tabs', () => {
  expect(mocks.activate).not.toHaveBeenCalled()
})

test('signed-out toolbar clicks and stale popup actions use the same login tab', async () => {
  const url = 'https://reader.test/login?from=extension'
  await vi.waitFor(() => expect(setPopup).toHaveBeenLastCalledWith({ popup: '' }))
  expect(createTab).not.toHaveBeenCalled()
  toolbar.addListener.mock.calls[0][0]({ id: 1, windowId: 1 })
  await vi.waitFor(() => expect(createTab).toHaveBeenCalledWith({ url }))

  queryTabs.mockResolvedValue([{ id: 2, url }])
  for (const method of ['open', 'save', 'open-inbox']) {
    const response = await new Promise(resolve => messages.addListener.mock.calls[0][0](
      { target: 'action-popup', method }, { id: 'test', url: 'chrome-extension://test/popup.html' }, resolve
    ))
    expect(response).toEqual({ ok: true, redirected: true })
  }
  expect(createTab).toHaveBeenCalledOnce()
  expect(updateTab).toHaveBeenCalledWith(2, { active: true })
})

test('query failure does not interrupt installation and does not expose raw errors', async () => {
  mocks.activate.mockRejectedValueOnce(new Error('Private URL'))
  await expect(install('install')).resolves.toBeUndefined()
  expect(mocks.menus).toHaveBeenCalledOnce()
  expect(mocks.openTab).toHaveBeenCalledOnce()
  expect(console.warn).toHaveBeenCalledWith('[install] collector activation failed')
  expect(analytics.setEnabled).toHaveBeenCalledWith(true)
})

test('pending activation does not delay authenticated install synchronization', async () => {
  let finishActivation!: () => void
  mocks.activate.mockImplementationOnce(() => new Promise(resolve => { finishActivation = resolve }))
  mocks.hasSession.mockResolvedValue(true)
  await install('install')
  expect(mocks.activate).toHaveBeenCalledOnce()
  expect(mocks.status).toHaveBeenCalledOnce()
  expect(mocks.openTab).not.toHaveBeenCalled()
  expect(analytics.setEnabled).toHaveBeenCalledWith(true)
  finishActivation()
})
