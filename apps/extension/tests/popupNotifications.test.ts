import { clearPopupInbox, dismissPopupSave, PopupNotifications, selectPopupNotifications } from '../src/entrypoints/background/popupNotifications'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('Inbox clears all ready saves and retains older unfinished bookmarks', () => {
  const checkpoint = {
    userKey: 'user',
    seenAt: 20,
    ready: [{ id: 'b', createdAt: 11 }, { id: 'c', createdAt: 12 }, { id: 'd', createdAt: 13 }],
    pendingIds: ['a']
  }
  expect(clearPopupInbox({ inboxSeenAt: 10, pendingAtInboxIds: [], dismissedIds: ['opened'] }, checkpoint)).toEqual({
    inboxSeenAt: 20,
    pendingAtInboxIds: ['a'],
    dismissedIds: ['opened', 'b', 'c', 'd']
  })
})

test('first use suppresses history and a delayed Inbox event cannot undo newer state', () => {
  const checkpoint = { userKey: 'user', seenAt: 20, ready: [{ id: 'old', createdAt: 15 }], pendingIds: ['processing'] }
  const baseline = clearPopupInbox(undefined, checkpoint)
  expect(baseline).toEqual({ inboxSeenAt: 20, pendingAtInboxIds: ['processing'], dismissedIds: [] })
  const afterClick = dismissPopupSave(baseline, 'processing')
  expect(clearPopupInbox(afterClick, { ...checkpoint, seenAt: 19 })).toBe(afterClick)
  expect(afterClick.dismissedIds).toEqual(['processing'])
})

test('both kinds share the slots, otherwise one kind can fill both', () => {
  const subscriptions = ['one', 'two'].map(code => ({ kind: 'subscription' as const, id: code, title: code, throughAt: '2026-11-26T12:00:00Z' }))
  const saves = ['first', 'second'].map(id => ({ kind: 'save' as const, id, title: id }))
  expect(selectPopupNotifications(subscriptions, saves)).toEqual([subscriptions[0], saves[0]])
  expect(selectPopupNotifications(subscriptions, [])).toEqual(subscriptions)
  expect(selectPopupNotifications([], saves)).toEqual(saves)
  expect(selectPopupNotifications([], [])).toEqual([])
})

test('the toolbar shares one live query with the popup and keeps watching after it closes', async () => {
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubGlobal('browser', { storage: { local: {
    get: async (key: string) => ({ [key]: { inboxSeenAt: 1, pendingAtInboxIds: [], dismissedIds: [] } })
  } } })
  const token = `header.${btoa(JSON.stringify({ id: 'reader' }))}.signature`
  const session = { getToken: async () => token, hasSession: vi.fn(async () => true) }
  const saved = { kind: 'save' as const, id: 'ready', title: 'Ready' }
  let saves = [saved]
  const startPopupWatch = vi.fn<(id: string) => Promise<boolean>>(async () => true)
  const bridge = {
    startPopupWatch,
    stopPopupWatch: vi.fn(async () => {}),
    readPopupSubscription: vi.fn(async () => true),
    popupNotifications: async () => ({ userKey: 'reader', hasSynced: true, subscriptions: [], saves })
  }
  const showDot = vi.fn()
  const notifications = new PopupNotifications(session, bridge, showDot)

  notifications.refresh()
  await vi.waitFor(() => expect(showDot).toHaveBeenLastCalledWith(true))

  const disconnect = vi.fn()
  const postMessage = vi.fn()
  notifications.connect({
    postMessage,
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: disconnect }
  } as unknown as Browser.runtime.Port, async () => true)
  await vi.waitFor(() => expect(postMessage).toHaveBeenLastCalledWith({ state: 'ready', items: [saved] }))
  expect(showDot).toHaveBeenLastCalledWith(true)
  expect(startPopupWatch).toHaveBeenCalledOnce()
  disconnect.mock.calls[0][0]()

  const [watchId] = startPopupWatch.mock.calls[0]
  saves = []
  notifications.refresh(watchId)
  await vi.waitFor(() => expect(showDot).toHaveBeenLastCalledWith(false))
  expect(postMessage).toHaveBeenCalledOnce()

  saves = [saved]
  notifications.refresh(watchId)
  await vi.waitFor(() => expect(showDot).toHaveBeenLastCalledWith(true))
  notifications.reset()
  expect(showDot).toHaveBeenLastCalledWith(false)
})

test('notification clicks check sign-in, and an interactive bridge 401 carries the failed token', async () => {
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  const createTab = vi.fn(async () => {})
  vi.stubGlobal('browser', { tabs: { create: createTab }, storage: { local: {
    get: async (key: string) => ({ [key]: { inboxSeenAt: 1, pendingAtInboxIds: [], dismissedIds: [] } })
  } } })
  const token = `header.${btoa(JSON.stringify({ id: 'reader' }))}.signature`
  const subscription = { kind: 'subscription' as const, id: 'feed', title: 'Feed', throughAt: '2026-11-26T12:00:00Z' }
  const readPopupSubscription = vi.fn(async () => 'auth-required' as const)
  const notifications = new PopupNotifications({ getToken: async () => token, hasSession: async () => true }, {
    startPopupWatch: async () => true,
    stopPopupWatch: async () => {},
    readPopupSubscription,
    popupNotifications: async () => ({ userKey: 'reader', hasSynced: true, subscriptions: [subscription], saves: [] })
  }, vi.fn())
  const checkLogin = vi.fn(async (failedToken?: string) => !failedToken)
  const listen = vi.fn()
  const postMessage = vi.fn()
  notifications.connect({ postMessage, onMessage: { addListener: listen }, onDisconnect: { addListener: vi.fn() } } as unknown as Browser.runtime.Port, checkLogin)
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ state: 'ready', items: [subscription] }))
  const click = () => listen.mock.calls[0][0]({ method: 'open', kind: subscription.kind, id: subscription.id, throughAt: subscription.throughAt })

  click()
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ method: 'opened', ok: true }))
  expect(checkLogin).toHaveBeenCalledWith(token)
  expect(readPopupSubscription).toHaveBeenCalledOnce()

  checkLogin.mockResolvedValue(false)
  postMessage.mockClear()
  click()
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ method: 'opened', ok: true }))
  expect(readPopupSubscription).toHaveBeenCalledOnce()
  expect(createTab).not.toHaveBeenCalled()
})
