import { afterEach, describe, expect, test, vi } from 'vitest'
import { NotificationMessage } from '@/infra/message/notification'
import { noticeType, type UserRepo, type userNoticePO } from '@/infra/repository/dbUser'
import type { ContextManager } from '@/utils/context'

const payload: userNoticePO = {
  user_id: 42,
  type: 'comment',
  source: 'share',
  title: 'New comment',
  body: 'Comment body',
  details: '{}',
  is_read: false,
  created_at: new Date()
}

function setup(browserData = JSON.stringify({ endpoint: 'https://push.example/send', keys: { auth: 'auth', p256dh: 'key' } })) {
  const devices = [
    { id: 1, type: noticeType.BROWSER, data: browserData },
    { id: 2, type: noticeType.WEBSOCKET, data: JSON.stringify({ region: 'wnam', uuid: 'socket-token' }) }
  ]
  const repo = {
    requireActiveUser: vi.fn().mockResolvedValue(undefined),
    getUserOnlineDevice: vi.fn().mockResolvedValue(devices),
    getUserUnreadCount: vi.fn().mockResolvedValue(3),
    removeUserPushDevice: vi.fn()
  }
  const stub = { sendReminder: vi.fn().mockResolvedValue(true), sendBookmarkChange: vi.fn().mockResolvedValue(undefined) }
  const namespace = { idFromName: vi.fn().mockReturnValue('global-id'), get: vi.fn().mockReturnValue(stub) }
  const env = { WEBSOCKET_SERVER: namespace } as unknown as Env
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return { message: new NotificationMessage(repo as unknown as UserRepo), repo, stub, namespace, env, fetch, error, devices }
}

afterEach(() => vi.restoreAllMocks())

describe('NotificationMessage without browser push credentials', () => {
  test.each([undefined, 'invalid subscription JSON'])('skips browser subscriptions without parsing or removing them: %s', async browserData => {
    const { message, repo, stub, namespace, env, fetch, error } = setup(browserData)

    await message.sendNotificationToUser(env, payload)

    expect(repo.requireActiveUser).toHaveBeenCalledWith(42)
    expect(repo.getUserOnlineDevice).toHaveBeenCalledWith(42)
    expect(repo.getUserUnreadCount).toHaveBeenCalledWith(42)
    expect(namespace.idFromName).toHaveBeenCalledWith('global')
    expect(namespace.get).toHaveBeenCalledWith('global-id', { locationHint: 'wnam' })
    expect(stub.sendReminder).toHaveBeenCalledExactlyOnceWith('socket-token', 3)
    expect(repo.removeUserPushDevice).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('browser-only notification batches need no WebSocket binding and preserve subscriptions', async () => {
    const { message, repo, devices, fetch, error } = setup()
    repo.getUserOnlineDevice.mockResolvedValue(devices.slice(0, 1))

    await message.batchSendNotification({} as Env, [payload, { ...payload, user_id: 43 }])

    expect(repo.requireActiveUser.mock.calls).toEqual([[42], [43]])
    expect(repo.getUserUnreadCount.mock.calls).toEqual([[42], [43]])
    expect(repo.removeUserPushDevice).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('cleans up only a disconnected WebSocket device', async () => {
    const { message, repo, stub, env, fetch, error } = setup()
    stub.sendReminder.mockResolvedValue(false)

    await message.sendNotificationToUser(env, payload)

    expect(repo.removeUserPushDevice).toHaveBeenCalledExactlyOnceWith(2)
    expect(fetch).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('unread reminders still reach WebSockets without touching browser subscriptions', async () => {
    const { message, repo, stub, env, fetch } = setup('invalid subscription JSON')

    await message.sendUnreaderReminder({ env, getUserId: () => 42 } as ContextManager)

    expect(stub.sendReminder).toHaveBeenCalledExactlyOnceWith('socket-token', 3)
    expect(repo.removeUserPushDevice).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('bookmark changes still reach the WebSocket server', async () => {
    const { message, repo, stub, namespace, env, fetch, error } = setup()
    const change = { user_id: 42, bookmark_id: 7, created_at: new Date(), target_url: 'https://example.com', action: 'add' as const }

    await message.sendBookmarkChange(env, change)

    expect(namespace.idFromName).toHaveBeenCalledWith('global')
    expect(namespace.get).toHaveBeenCalledWith('global-id')
    expect(stub.sendBookmarkChange).toHaveBeenCalledExactlyOnceWith(change)
    expect(repo.removeUserPushDevice).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
