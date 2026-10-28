import { expect, it, vi } from 'vitest'
import { createBookmarkSaveGuard } from '~/composables/bookmark/bookmarkSaveGuard'

it('checks synced processing and releases the local request lock after completion', async () => {
  const guard = createBookmarkSaveGuard()
  const row = { id: 'one', status: 'success', updated_at: 'before' }
  const read = vi.fn(async () => ({ ...row }))
  const save = vi.fn(async () => {})
  expect(await guard.run('1', 'url', read, save)).toBe(true)
  row.status = 'pending_retry'; row.updated_at = 'during'
  expect(await guard.run('1', 'url', read, save)).toBe(false)
  row.status = 'parseing'
  expect(await guard.run('1', 'url', read, save)).toBe(false)
  row.status = 'success'; row.updated_at = 'after'
  expect(await guard.run('1', 'url', read, save)).toBe(true)
  expect(save).toHaveBeenCalledTimes(2)
})

it('blocks concurrent submits before lookup finishes and scopes locks by account and URL', async () => {
  const guard = createBookmarkSaveGuard()
  let finish!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const read = vi.fn(async () => null)
  const first = guard.run('1', 'url', read, save)
  expect(await guard.run('1', 'url', read, save)).toBe(false)
  await Promise.resolve()
  finish(); await first
  expect(await guard.run('1', 'other', read, async () => {})).toBe(true)
  expect(await guard.run('2', 'url', read, async () => {})).toBe(true)
  expect(await guard.run('1', 'url', read, async () => {})).toBe(true)
})

it('uses active synced rows even without a known request and does not retry ambiguous failures', async () => {
  const guard = createBookmarkSaveGuard()
  const save = vi.fn(async () => {})
  expect(await guard.run('1', 'url', async () => ({ id: 'one', status: 'pending', updated_at: 'a' }), save)).toBe(false)
  expect(save).not.toHaveBeenCalled()
  const timeout = new Error('timeout'); timeout.name = 'TimeoutError'
  await expect(guard.run('1', 'unknown', async () => null, async () => { throw timeout })).rejects.toThrow('timeout')
  expect(save).not.toHaveBeenCalled()
  expect(await guard.run('1', 'unknown', async () => null, save)).toBe(true)
})
