import { expect, test, vi } from 'vitest'
vi.mock('@/middleware/auth', () => ({ authToken: vi.fn(async ctx => ctx.setUserInfo(42, 84, '', 'en')) }))
vi.mock('@/infra/message/notification', () => ({ NotificationMessage: class {} }))
vi.mock('@/infra/repository/dbBookmark', () => ({ BookmarkRepo: class {} }))
vi.mock('@/infra/repository/dbCollection', () => ({ CollectionRepo: class {} }))
import { NotificationService } from '@/domain/notification'
import { ContextManager } from '@/utils/context'
import { UnauthorizedError } from '@/const/err'

test('deleted users cannot register a notification device or acquire a DO', async () => {
  const repo = { requireActiveUser: vi.fn().mockRejectedValue(UnauthorizedError()), addUserPushDevice: vi.fn() }
  const idFromName = vi.fn()
  const ctx = new ContextManager({} as ExecutionContext, { WEBSOCKET_SERVER: { idFromName } } as any)
  const service = new NotificationService(repo as any, {} as any, {} as any, {} as any)
  await expect(service.connectNotification(ctx, new Request('https://api-reader.slax.com/v1/user/messages'), 'token')).rejects.toMatchObject({ errCode: 401 })
  expect(repo.requireActiveUser).toHaveBeenCalledWith(42)
  expect(repo.addUserPushDevice).not.toHaveBeenCalled()
  expect(idFromName).not.toHaveBeenCalled()
})
