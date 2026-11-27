import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { expect, it, vi } from 'vitest'

it('guards Collect programmatic/reopen submissions until the request settles', async () => {
  const source = readFileSync(new URL('../src/components/Collect.vue', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('let submission:'), source.indexOf('\nconst deleteBookmark'))
  const compiled = await transformWithEsbuild(body, 'collect.ts', { loader: 'ts', target: 'es2022' })
  let resolve!: (value: unknown) => void
  const request = { post: vi.fn(() => new Promise(r => { resolve = r })) }
  const loading = { value: false }
  const hideLoading = () => { loading.value = false }
  const showTips = vi.fn(hideLoading)
  const context = {
    loading, labBlocked: { value: false }, bookmarkId: { value: 0 }, bookmarkExists: { value: false },
    showLoading: () => { loading.value = true }, hideLoading, showTips, request,
    RESTMethodPath: { ADD_BOOKMARK: '/add' }, getRequestParams: () => ({ target_url: 'https://example.com' }),
    props: { browser: { runtime: { sendMessage: vi.fn(async () => {}) } } },
    MessageTypeAction: {}, BookmarkActionType: {}, RequestError: class extends Error {},
    window: { location: { href: 'https://example.com' } }, setTimeout: vi.fn()
  }
  const create = new Function(...Object.keys(context), `let keepPopupOpen = false; ${compiled.code}; return { addBookmark, submitBookmark }`)
  const { addBookmark: add, submitBookmark: submit } = create(...Object.values(context))
  const first = add()
  // Even if presentation loading is reset, the request guard remains authoritative.
  loading.value = false
  await add()
  const toolbar = submit()
  expect(request.post).toHaveBeenCalledOnce()
  resolve({ bmId: 3 }); await first
  await expect(toolbar).resolves.toEqual({ bmId: 3 })
  expect(showTips).toHaveBeenCalledWith({ kind: 'message', key: 'collection_successful' })
  const next = add()
  expect(request.post).toHaveBeenCalledTimes(2)
  resolve({ bmId: 3 }); await next
})
