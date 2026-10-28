import { test, expect } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { assertExternalNewsletterTarget, isNewsletterTarget } from '@/utils/newsletterTarget'
test('internal mail identities cannot enter inline or URL acquisitions before dependencies mutate state', async () => {
  expect(isNewsletterTarget(' SLAX-NEWSLETTER://message/1 ')).toBe(true)
  expect(isNewsletterTarget('https://example.com')).toBe(false)
  expect(() => assertExternalNewsletterTarget('slax-newsletter://message/1')).toThrow()
  const service = Object.create(BookmarkService.prototype)
  await expect(service.addBookmark({} as never, { target_url: 'slax-newsletter://message/1' } as never)).rejects.toMatchObject({ name: 'ERROR_PARAM' })
  await expect(service.addUrlBookmark({} as never, { target_url: 'slax-newsletter://message/1' } as never, 0)).rejects.toMatchObject({ name: 'ERROR_PARAM' })
})
test.each(['own', 'foreign', 'new'])('uploaded internal create PUT %s is rejected before any snapshot or relation mutation', async id => {
  const state = { status: 'success', contentKey: 'html/body/retained.html', archived: true, executions: 0 }
  const orchestrator = Object.assign(Object.create(SyncOrchestrator.prototype), {
    userService: { getUserInfo: async () => ({ uuid: 'owner' }) },
    dbSyncBatch: { executeOrderedOperations: async () => { state.executions++; state.status = 'pending'; state.archived = false; return [] } }
  }) as SyncOrchestrator
  const change = { table: 'sr_user_bookmark', id, op: 'PUT', data: { metadata: JSON.stringify({ bookmark: { target_url: 'slax-newsletter://message/1', title: 'Mail' } }) } } as const
  await expect(orchestrator.syncChanges({ getUserId: () => 1, env: {} } as never, [change])).rejects.toMatchObject({ name: 'ERROR_PARAM' })
  expect(state).toEqual({ status: 'success', contentKey: 'html/body/retained.html', archived: true, executions: 0 })
})
