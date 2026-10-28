import { test, expect } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { assertExternalNewsletterTarget, isNewsletterTarget } from '@/utils/newsletterTarget'
test('internal mail identities cannot enter inline or URL acquisitions before dependencies mutate state', async () => {
  expect(isNewsletterTarget(' SLAX-NEWSLETTER://message/1 ')).toBe(true)
  expect(isNewsletterTarget('https://example.com')).toBe(false)
  expect(() => assertExternalNewsletterTarget('slax-newsletter://message/1')).toThrow()
  const service = Object.create(BookmarkService.prototype)
  await expect(service.addBookmark({} as never, { target_url: 'slax-newsletter://message/1' } as never)).rejects.toMatchObject({ name: 'ERROR_PARAM' })
  await expect(service.addUrlBookmark({} as never, { target_url: 'slax-newsletter://message/1' } as never, 0)).rejects.toMatchObject({ name: 'ERROR_PARAM' })
})
test('sync PUT cannot create or reparse mail, but an owned committed snapshot replay is harmless', async () => {
  const repo = Object.create(DBSyncBatchOperation.prototype),
    operation = { type: 'create_bookmark', userId: 1, bookmarkUuid: 'own', data: { targetUrl: 'slax-newsletter://message/1', isNewBookmark: true } }
  await expect(repo.executeCreateBookmark({ sr_user_bookmark: { findUnique: async () => null } } as never, operation as never)).rejects.toThrow()
  const existing = { uuid: 'own', user_id: 1, bookmark: { private_user: 1, target_url: 'slax-newsletter://message/1', status: 'success' } }
  expect(await repo.executeCreateBookmark({ sr_user_bookmark: { findUnique: async () => existing } } as never, operation as never)).toBeNull()
  expect(existing.bookmark.status).toBe('success')
})
