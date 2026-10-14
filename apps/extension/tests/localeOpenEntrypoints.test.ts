import { afterEach, expect, it, vi } from 'vitest'
const { refresh, openCollectPopup } = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), openCollectPopup: vi.fn(async () => {}) }))
vi.mock('../src/entrypoints/background/localeService', () => ({
  LocaleService: class {
    initialize = async () => {}
    refresh = refresh
  }
}))
vi.mock('../src/entrypoints/background/browserService', () => ({ BrowserService: { openCollectPopup, watchPinnedStatusChanges: vi.fn() } }))
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
it('calibrates locale for toolbar, context-menu and keyboard opens', async () => {
  const event = () => ({ addListener: vi.fn() })
  const toolbar = event(),
    menu = event(),
    command = event()
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubGlobal('storage', { removeItem: async () => {} })
  vi.stubGlobal('defineBackground', (fn: () => void) => ({ main: fn }))
  vi.stubGlobal('browser', {
    i18n: { getUILanguage: () => 'en' },
    cookies: { get: async () => null, onChanged: event() },
    alarms: { get: async () => ({}), onAlarm: event() },
    webRequest: { onCompleted: event() },
    runtime: { onInstalled: event(), onMessage: event(), setUninstallURL: vi.fn(async () => {}) },
    tabs: { onUpdated: event(), onRemoved: event() },
    action: { onClicked: toolbar },
    contextMenus: { onClicked: menu },
    commands: { onCommand: command }
  })
  const { default: start } = await import('../src/entrypoints/background/index')
  start.main()
  await Promise.resolve()
  for (const invoke of [
    () => toolbar.addListener.mock.calls[0][0]({ id: 1 }),
    () => menu.addListener.mock.calls[0][0]({ menuItemId: 'collect' }, { id: 1 }),
    () => command.addListener.mock.calls[0][0]('open_collect', { id: 1 })
  ]) {
    refresh.mockClear()
    await invoke()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledWith('open')
  }
  expect(openCollectPopup).toHaveBeenCalledTimes(3)
})
