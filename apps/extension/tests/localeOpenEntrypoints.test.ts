import { afterEach, expect, it, vi } from 'vitest'
const { refresh, openCollectPopup } = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), openCollectPopup: vi.fn(async () => {}) }))
vi.mock('../src/entrypoints/background/localeService', () => ({
  LocaleService: class {
    initialize = async () => {}
    refresh = refresh
  }
}))
vi.mock('../src/entrypoints/background/browserService', () => ({ BrowserService: { openCollectPopup, watchPinnedStatusChanges: vi.fn(), setToolbarNotificationDot: vi.fn() } }))
vi.mock('../src/entrypoints/background/authService', () => ({
  AuthService: class {
    checkLogin = async () => true
  }
}))
vi.mock('../src/entrypoints/background/metricService', () => ({
  MetricService: class {
    track = async () => {}
  }
}))
vi.mock('../src/entrypoints/background/messageHandler', () => ({ MessageHandler: class {} }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('calibrates locale when a popup or context-menu save is selected', async () => {
  const event = () => ({ addListener: vi.fn() })
  const toolbar = event(),
    menu = event(),
    command = event(),
    message = event()
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubEnv('COOKIE_TOKEN_NAME', 'fixture_session')
  const token = `x.${btoa(JSON.stringify({ id: 'fixture-user' }))}.x`
  vi.stubGlobal('storage', { removeItem: async () => {} })
  vi.stubGlobal('defineBackground', (fn: () => void) => ({ main: fn }))
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    cookies: { get: async () => ({ value: token }), onChanged: event() },
    storage: { session: { get: async () => ({}) } },
    alarms: { get: async () => ({}), onAlarm: event() },
    webRequest: { onCompleted: event() },
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test${path}`, onConnect: event(), onInstalled: event(), onMessage: message, setUninstallURL: vi.fn(async () => {}) },
    tabs: { get: async () => ({ id: 1, url: 'https://site.test' }), onUpdated: event(), onRemoved: event(), onActivated: event(), query: async () => [{ id: 1 }] },
    action: { onClicked: toolbar, setPopup: vi.fn(async () => {}) },
    contextMenus: { onClicked: menu },
    commands: { onCommand: command }
  })
  const { default: start } = await import('../src/entrypoints/background/index')
  start.main()
  await Promise.resolve()
  expect(toolbar.addListener).toHaveBeenCalledOnce()
  expect(command.addListener).not.toHaveBeenCalled()
  for (const invoke of [
    () => new Promise(resolve => message.addListener.mock.calls[0][0](
      { target: 'action-popup', method: 'save', tabId: 1, url: 'https://site.test' },
      { id: 'test', url: 'chrome-extension://test/popup.html' },
      resolve
    )),
    () => menu.addListener.mock.calls[0][0]({ menuItemId: 'collect' }, { id: 1 })
  ]) {
    refresh.mockClear()
    await invoke()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledWith('open')
  }
  expect(openCollectPopup).toHaveBeenCalledTimes(2)
})
