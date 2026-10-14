import { afterEach, expect, test, vi } from 'vitest'
vi.mock('@/middleware/auth', () => ({ authToken: vi.fn() }))
vi.mock('@/infra/repository/dbBookmark', () => ({ BookmarkRepo: class {} }))
vi.mock('@/infra/repository/dbCollection', () => ({ CollectionRepo: class {} }))
import { NotificationService } from '@/domain/notification'
import { NotificationMessage } from '@/infra/message/notification'
import { noticeType, type UserRepo, type userNoticePO } from '@/infra/repository/dbUser'

afterEach(() => vi.restoreAllMocks())

test('creates an in-app notification and delivers its unread count without browser push credentials', async () => {
  const stored: userNoticePO[] = []
  const repo = {
    getInfoByUserId: vi.fn(async (id: number) => ({ id, lang: 'en', name: `User ${id}`, picture: '' })),
    addUserNotice: vi.fn(async (notice: userNoticePO) => {
      const result = { ...notice, id: 7 }
      stored.push(result)
      return result
    }),
    requireActiveUser: vi.fn().mockResolvedValue(undefined),
    getUserOnlineDevice: vi.fn().mockResolvedValue([
      { id: 1, type: noticeType.BROWSER, data: 'unused subscription' },
      { id: 2, type: noticeType.WEBSOCKET, data: JSON.stringify({ region: 'wnam', uuid: 'socket-token' }) }
    ]),
    getUserUnreadCount: vi.fn(async () => stored.filter(notice => !notice.is_read).length),
    removeUserPushDevice: vi.fn()
  }
  const sendReminder = vi.fn().mockResolvedValue(true)
  const env = { WEBSOCKET_SERVER: { idFromName: vi.fn(), get: vi.fn().mockReturnValue({ sendReminder }) } } as unknown as Env
  const userRepo = repo as unknown as UserRepo
  const message = new NotificationMessage(userRepo)
  const service = new NotificationService(userRepo, {} as never, {} as never, message)
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  await service.createCollectionNotification(env, 'subscribe', { ownerId: 42, subscriberId: 43, collectionName: 'Reading', collectionCode: 'reading' })

  expect(repo.addUserNotice).toHaveBeenCalledOnce()
  expect(stored).toEqual([expect.objectContaining({ id: 7, user_id: 42, type: 'collection_subscriber', source: 'collection', is_read: false })])
  expect(sendReminder).toHaveBeenCalledExactlyOnceWith('socket-token', 1)
  expect(repo.removeUserPushDevice).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
})
