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
  watchPinnedStatusChanges: vi.fn()
} }))
vi.mock('../src/entrypoints/background/localeAlarm', () => ({ ensureLocaleCalibrationAlarm: mocks.alarm }))
vi.mock('../src/entrypoints/background/localeService', () => ({ LocaleService: class {
  initialize = async () => {}
  refresh = async () => {}
} }))
vi.mock('../src/entrypoints/background/sessionService', () => ({
  SessionService: class { getToken = async () => null; hasSession = mocks.hasSession },
  getTokenIdentityKeys: () => new Set(), getSessionAccountKey: async () => null, userInfoMatchesIdentity: () => false
}))
vi.mock('../src/entrypoints/background/bridgeService', () => ({
  BridgeService: class { status = mocks.status }, canUseBridgeState: () => false
}))
vi.mock('../src/entrypoints/background/storageService', () => ({ StorageService: class { clearUserData = async () => {} } }))
vi.mock('../src/entrypoints/background/authService', () => ({ AuthService: class {} }))
vi.mock('../src/entrypoints/background/metricService', () => ({ MetricService: class {} }))
vi.mock('../src/entrypoints/background/messageHandler', () => ({ MessageHandler: class {} }))

const event = () => ({ addListener: vi.fn() })
let installed: ReturnType<typeof event>

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.activate.mockResolvedValue(undefined)
  mocks.reset.mockResolvedValue(undefined)
  mocks.hasSession.mockResolvedValue(false)
  mocks.status.mockResolvedValue({ ok: false })
  installed = event()
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubGlobal('analytics', { setEnabled: vi.fn() })
  vi.stubGlobal('defineBackground', (fn: () => void) => ({ main: fn }))
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    cookies: { onChanged: event() }, alarms: { onAlarm: event() },
    webRequest: { onCompleted: event() },
    runtime: { onInstalled: installed, onMessage: event(), setUninstallURL: vi.fn() },
    tabs: { query: vi.fn(async () => []), onUpdated: event(), onRemoved: event(), onActivated: event() },
    action: { onClicked: event() }, contextMenus: { onClicked: event() }, commands: { onCommand: event() }
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
