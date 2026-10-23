/**
 * The generated cron dispatcher runs every job of a schedule. Two jobs on "*\/5" (import progress
 * and the YouTube article sweep) must both run; a Map keyed by schedule alone kept only the last.
 * 来源: script/gen-cron.ts → src/di/generated/cronjob.ts
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/utils/context', () => ({ ContextManager: vi.fn() }))
vi.mock('@/handler/cron/bookmarkJob', () => ({ BookmarkJob: class BookmarkJob {} }))
vi.mock('@/handler/cron/collectionJob', () => ({ CollectionJob: class CollectionJob {} }))
vi.mock('@/handler/cron/youtubeArticleJob', () => ({ YoutubeArticleJob: class YoutubeArticleJob {} }))
vi.mock('../../src/handler/cron/bookmarkJob', () => ({ BookmarkJob: class BookmarkJob {} }))
vi.mock('../../src/handler/cron/collectionJob', () => ({ CollectionJob: class CollectionJob {} }))
vi.mock('../../src/handler/cron/youtubeArticleJob', () => ({ YoutubeArticleJob: class YoutubeArticleJob {} }))

import { handleCronjob } from '@/di/generated/cronjob'

function fakeContainer() {
  const called: string[] = []
  const job = new Proxy({}, { get: (_t, name: string) => async () => void called.push(name) })
  return { container: { resolve: () => job } as any, called }
}

describe('handleCronjob', () => {
  test('every job on */5 runs', async () => {
    const { container, called } = fakeContainer()
    const waits: Promise<unknown>[] = []
    await handleCronjob(container, { cron: '*/5 * * * *' }, {} as Env, { waitUntil: (p: Promise<unknown>) => waits.push(p) } as any)
    await Promise.all(waits)
    expect(called.sort()).toEqual(['checkImportProgress', 'maintainSnapshots', 'recoverDeletedUsers', 'recoverPayments', 'refreshRss', 'sweepPodcasts', 'sweepYoutubeArticles'])
  })

  test('a schedule with one job runs just that job; an unknown schedule runs nothing', async () => {
    const { container, called } = fakeContainer()
    const waits: Promise<unknown>[] = []
    const exec = { waitUntil: (p: Promise<unknown>) => waits.push(p) } as any
    await handleCronjob(container, { cron: '0 */1 * * *' }, {} as Env, exec)
    await handleCronjob(container, { cron: '7 7 * * *' }, {} as Env, exec)
    await Promise.all(waits)
    expect(called).toEqual(['clearExpiredTrashedBookmark'])
  })
})
