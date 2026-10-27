// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transpile } from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Execute the production action with controlled persistence and message boundaries.
const source = readFileSync(resolve('app/pages/b/[id].vue'), 'utf8')
const action = source.slice(source.indexOf('const archiveBookmark = async'), source.indexOf('const starBookmark = async'))
const createReader = () => {
  const state = {
    token: 'session-a', getUserToken: () => state.token, deriveAccountKey: () => 'account-a',
    uuid: 'uuid-1', bookmarkUid: { value: 'uuid-1' }, isArchived: { value: false },
    accountGeneration: { value: 0 }, localFirst: { value: false }, restArchived: { value: 'inbox' },
    local: { setArchive: vi.fn().mockResolvedValue({}) },
    post: vi.fn().mockResolvedValue({}), request: () => ({ post: state.post }),
    postChannelMessage: vi.fn(), showSuccessToast: vi.fn(),
    RESTMethodPath: { BOOKMARK_ARCHIVE: '/archive' }, t: (key: string) => key,
    Toast: { showToast: vi.fn() }, ToastType: { Error: 'error' }
  }
  const run = runInNewContext(transpile(`${action}\narchiveBookmark`, { target: 9 }), state) as (element: null) => Promise<void>
  return { state, run }
}

describe('reader archive notification', () => {
  it.each([false, true])('publishes a successful archive with local mode %s', async local => {
    const { state, run } = createReader()
    state.localFirst.value = local
    await run(null)
    expect(state.postChannelMessage).toHaveBeenCalledWith('bookmarkArchive', { accountKey: 'account-a', uuid: 'uuid-1', archived: true })
  })

  it('publishes unarchive state', async () => {
    const { state, run } = createReader()
    state.isArchived.value = true
    await run(null)
    expect(state.postChannelMessage).toHaveBeenCalledWith('bookmarkArchive', { accountKey: 'account-a', uuid: 'uuid-1', archived: false })
  })

  it('does not publish a failed write', async () => {
    const { state, run } = createReader()
    state.post.mockRejectedValue(new Error('offline'))
    await run(null)
    expect(state.postChannelMessage).not.toHaveBeenCalled()
  })

  it('does not publish or update the new session after an account change', async () => {
    const { state, run } = createReader()
    let finish!: (value: unknown) => void
    state.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = run(null)
    state.token = 'session-b'
    state.accountGeneration.value++
    finish({})
    await pending
    expect(state.postChannelMessage).not.toHaveBeenCalled()
    expect(state.restArchived.value).toBe('inbox')
    expect(state.showSuccessToast).not.toHaveBeenCalled()
  })
})
