import { describe, expect, test } from 'vitest'
import { auth } from '@/middleware/auth'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '@/const/edge'
import { ContextManager } from '@/utils/context'
import type { Container } from '@/decorators/di'

const execution = {} as ExecutionContext
const container = { resolve: () => ({ $queryRaw: async () => [{ id: 42 }] }) } as unknown as Container

function mockCtx(secret = 'shared') {
  return new ContextManager(execution, { EDGE_SHARED_SECRET: secret, HASH_IDS_SALT: 'salt' } as Env)
}

describe('trusted edge authentication', () => {
  test.each([undefined, 'other-product', 'unknown'])('rejects wrong or absent product audience %s before setting identity', async audience => {
    const ctx = mockCtx()
    const raw = encodeEdgeIdentity({ deId: 42, enId: 84, email: 'user@example.com', lang: 'en', audience } as never)
    const request = new Request('https://api-reader.slax.com/v1/user/me', { headers: { [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: raw } })
    await expect(auth(request, ctx, container)).rejects.toMatchObject({ errCode: 401 })
    expect(ctx.getUserId()).toBe(0)
  })

  test('rejects malformed trusted identity', async () => {
    await expect(
      auth(new Request('https://api-reader.slax.com/v1/user/me', { headers: { [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: 'invalid' } }), mockCtx(), container)
    ).rejects.toMatchObject({ errCode: 401 })
  })

  test('restores an identity only when both trusted headers are valid', async () => {
    const ctx = mockCtx()
    const identity = encodeEdgeIdentity({ deId: 42, enId: 84, email: 'user@example.com', lang: 'zh-CN', audience: 'reader' })
    const request = new Request('https://api-reader.slax.com/v1/bookmark/list', {
      headers: { [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: identity }
    })

    await expect(auth(request, ctx, container)).resolves.toBeUndefined()
    expect(ctx.getUserId()).toBe(42)
    expect(ctx.getEncodeUserId()).toBe(84)
    expect(ctx.getUserEmail()).toBe('user@example.com')
    expect(ctx.getlang()).toBe('zh')
  })

  test('does not trust a forged secret or a secret without an identity', async () => {
    const identity = encodeEdgeIdentity({ deId: 42, enId: 84, email: 'user@example.com', lang: 'en', audience: 'reader' })
    const forged = new Request('https://api-reader.slax.com/v1/bookmark/list', {
      headers: { [EDGE_SECRET_HEADER]: 'wrong', [EDGE_IDENTITY_HEADER]: identity }
    })
    const missingIdentity = new Request('https://api-reader.slax.com/v1/bookmark/list', {
      headers: { [EDGE_SECRET_HEADER]: 'shared' }
    })

    await expect(auth(forged, mockCtx(), container)).rejects.toMatchObject({ errCode: 401 })
    await expect(auth(missingIdentity, mockCtx(), container)).rejects.toMatchObject({ errCode: 401 })
  })
})

describe('internal email allowlist', () => {
  const gatedRequest = (email: string, url = 'https://api-reader-beta.slax.com/v1/user/me') => {
    const identity = encodeEdgeIdentity({ deId: 42, enId: 84, email, lang: 'en', audience: 'reader' } as never)
    return new Request(url, { headers: { [EDGE_SECRET_HEADER]: 'shared', [EDGE_IDENTITY_HEADER]: identity } })
  }
  const allowlistCtx = (whiteEmails?: string) =>
    new ContextManager(execution, { EDGE_SHARED_SECRET: 'shared', HASH_IDS_SALT: 'salt', WHITE_EMAILS: whiteEmails } as Env)

  test('denies the beta host and the dashboard prefix when no allowlist is configured', async () => {
    await expect(auth(gatedRequest('user@example.com'), allowlistCtx(), container)).rejects.toMatchObject({ errCode: 400 })
    await expect(auth(gatedRequest('user@example.com', 'https://api-reader.slax.com/m/dashboard'), allowlistCtx(), container)).rejects.toMatchObject({ errCode: 400 })
  })

  test('denies an address outside the configured allowlist', async () => {
    await expect(auth(gatedRequest('user@example.com'), allowlistCtx('other@example.com'), container)).rejects.toMatchObject({ errCode: 400 })
  })

  test('admits a listed address on the beta host and under the dashboard prefix', async () => {
    await expect(auth(gatedRequest('user@example.com'), allowlistCtx('user@example.com'), container)).resolves.toBeUndefined()
    await expect(auth(gatedRequest('user@example.com', 'https://api-reader.slax.com/m/dashboard'), allowlistCtx(' user@example.com , other@example.com '), container)).resolves.toBeUndefined()
  })

  test('ignores surrounding whitespace and empty entries', async () => {
    await expect(auth(gatedRequest('user@example.com'), allowlistCtx(' , user@example.com ,'), container)).resolves.toBeUndefined()
  })
})
