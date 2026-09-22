import { afterEach, expect, test, vi } from 'vitest'
import { requestLog } from '@/middleware/requestLog'
import { ContextManager } from '@/utils/context'

afterEach(() => vi.restoreAllMocks())

test.each(['/v1/user/login', '/v1/sync/changes', '/v1/subscription/create', '/v1/user/verification_codes'])('does not log sensitive request bodies on %s', async path => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const pending: Promise<unknown>[] = []
  const ctx = new ContextManager({ waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext, {} as Env)
  ctx.setUserInfo(1, 1, 'user@example.com', 'en')
  const request = new Request(`https://api.example${path}?token=PRIVATE-SENTINEL`, { method: 'POST', body: JSON.stringify({ data: 'PRIVATE-SENTINEL' }) })
  requestLog(request, ctx)
  await Promise.all(pending)
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE-SENTINEL')
  expect(log).toHaveBeenCalledWith(`[req] user 1 POST ${path}`)
  expect(await request.text()).toContain('PRIVATE-SENTINEL')
})
